import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { AppError, forbiddenError, notFoundError, validationError } from "../../lib/errors.js";
import { createIntegrationsRepository } from "../../db/repositories/integrations.repository.js";
import { createGoogleChatApi, type ChatSpace, type DirectoryPerson, type GoogleChatApi } from "../../providers/google/chat/google-chat.service.js";
import { grantedCapabilities } from "../../providers/google/oauth/google-oauth.types.js";
import { decryptSecret } from "../../lib/crypto.js";

/**
 * ADR-006 §8a — Google Chat for Zara. Reads one chat only when the user
 * asks (nothing synced, stored, or indexed); sends only from the approval
 * layer. Who someone is in a group space comes from the Workspace directory
 * (best effort, cached for an hour).
 */

/** A person (by email) or one of the user's group spaces. */
export type ChatTarget = { kind: "person"; email: string } | { kind: "space"; space: string; name: string };

export interface ChatReadMessage {
  from: string;
  at: Date | null;
  text: string;
}

const MESSAGE_TEXT_MAX = 500;
const DIRECTORY_TTL_MS = 60 * 60_000;
const DIRECTORY_RETRY_MS = 10 * 60_000;

export const CHAT_PERMISSION_MESSAGE =
  "Zara doesn't have Google Chat permission yet — reconnect Google in Settings → Actions (after enabling the Google Chat API in your Google Cloud project).";
const CHAT_REFUSED_MESSAGE =
  "Google Chat refused. Check that the Google Chat API is enabled and its Configuration page is filled in in your Google Cloud project, that you reconnected Google in Settings → Actions, and that you're signed in with your Workspace (company) account.";

/** 403s from Chat usually mean the API isn't set up, not that the user said no. */
function explain(err: unknown): never {
  if (err instanceof AppError && err.code === "forbidden" && /access was denied/i.test(err.message)) throw forbiddenError(CHAT_REFUSED_MESSAGE);
  throw err;
}

export function createGoogleChatService(dependencies?: { prisma?: PrismaClient; api?: GoogleChatApi; now?: () => number }) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const integrations = createIntegrationsRepository(prisma);
  const api = dependencies?.api ?? createGoogleChatApi();
  const clock = dependencies?.now ?? Date.now;
  const directoryCache = new Map<string, { at: number; ttl: number; people: Map<string, DirectoryPerson> }>();

  /** Token + the user's own Chat id, or a clear "reconnect" error. */
  async function access(userId: string): Promise<{ token: string; selfId: string | null; selfEmail: string | null }> {
    const integration = await integrations.findByUserAndProvider(userId, "google");
    if (!integration || integration.status !== "connected") throw notFoundError("Google isn't connected — connect it in Settings first.");
    if (!grantedCapabilities(integration.scopes).googleChat) throw forbiddenError(CHAT_PERMISSION_MESSAGE);
    return {
      token: decryptSecret(integration.refreshTokenEncrypted),
      selfId: integration.providerAccountId ? `users/${integration.providerAccountId}` : null,
      selfEmail: integration.providerAccountEmail?.toLowerCase() ?? null,
    };
  }

  async function directory(userId: string, token: string): Promise<Map<string, DirectoryPerson>> {
    const cached = directoryCache.get(userId);
    if (cached && clock() - cached.at < cached.ttl) return cached.people;
    try {
      const people = await api.directory(token);
      directoryCache.set(userId, { at: clock(), ttl: DIRECTORY_TTL_MS, people });
      return people;
    } catch {
      // No directory permission (or not a Workspace account): names stay unknown, try again later.
      const empty = new Map<string, DirectoryPerson>();
      directoryCache.set(userId, { at: clock(), ttl: DIRECTORY_RETRY_MS, people: empty });
      return empty;
    }
  }

  /** Finds a space by the user's words: an exact name wins, else a single partial match. */
  function matchSpace(spaces: ChatSpace[], words: string): ChatSpace | { error: string } {
    const wanted = words.trim().toLowerCase();
    const named = spaces.filter((space) => space.displayName);
    const exact = named.filter((space) => space.displayName.toLowerCase() === wanted);
    if (exact.length === 1) return exact[0]!;
    const partial = named.filter((space) => space.displayName.toLowerCase().includes(wanted));
    if (partial.length === 1) return partial[0]!;
    const names = (partial.length > 1 ? partial : named).map((space) => space.displayName).slice(0, 20);
    return {
      error:
        partial.length > 1
          ? `More than one space matches "${words}": ${names.join(", ")}. Ask the user which one.`
          : names.length
            ? `No space called "${words}". The user's spaces: ${names.join(", ")}.`
            : "The user isn't in any named Google Chat spaces.",
    };
  }

  return {
    /** Named group spaces the user is in. */
    async listSpaces(userId: string): Promise<string[]> {
      const { token } = await access(userId);
      const spaces = await api.listSpaces(token).catch(explain);
      return spaces.filter((space) => space.displayName).map((space) => space.displayName);
    },

    /** Resolves a person's email or a space's name into a send/read target. */
    async resolveTarget(userId: string, input: { person?: string | undefined; space?: string | undefined }): Promise<ChatTarget | { error: string }> {
      if (input.person) {
        const email = input.person.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Google Chat needs the person's email address — find it (search_emails / get_person_profile) or ask the user." };
        return { kind: "person", email };
      }
      if (input.space) {
        const { token } = await access(userId);
        const match = matchSpace(await api.listSpaces(token).catch(explain), input.space);
        return "error" in match ? match : { kind: "space", space: match.name, name: match.displayName };
      }
      return { error: "Say which person (email) or space." };
    },

    /** The newest messages of one chat, oldest first, with who wrote each one. */
    async readMessages(userId: string, target: ChatTarget, limit = 25): Promise<{ chat: string; messages: ChatReadMessage[] } | { error: string }> {
      const { token, selfId, selfEmail } = await access(userId);
      let spaceName: string;
      if (target.kind === "person") {
        const direct = await api.findDirectMessage(token, target.email).catch(explain);
        if (!direct) return { error: `There's no Google Chat with ${target.email} yet.` };
        spaceName = direct.name;
      } else {
        spaceName = target.space;
      }
      const messages = await api.listMessages(token, spaceName, Math.min(Math.max(limit, 1), 50)).catch(explain);
      const people = target.kind === "space" && messages.some((message) => message.senderId && message.senderId !== selfId) ? await directory(userId, token) : new Map<string, DirectoryPerson>();
      const nameOf = (senderId: string | null, isApp: boolean): string => {
        if (isApp) return "an app";
        if (senderId && senderId === selfId) return "You";
        if (target.kind === "person") return target.email;
        const person = senderId ? people.get(senderId) : undefined;
        if (person?.email && person.email === selfEmail) return "You";
        return person?.name ?? person?.email ?? "someone in the space";
      };
      return {
        chat: target.kind === "person" ? `1:1 chat with ${target.email}` : `space "${target.name}"`,
        messages: messages
          .filter((message) => message.text.trim())
          .map((message) => ({
            from: nameOf(message.senderId, message.senderIsApp),
            at: message.createTime ? new Date(message.createTime) : null,
            text: message.text.length > MESSAGE_TEXT_MAX ? `${message.text.slice(0, MESSAGE_TEXT_MAX)}…` : message.text,
          })),
      };
    },

    /** True if the user has never chatted 1:1 with this person (null when Chat can't tell). */
    async isNewContact(userId: string, email: string): Promise<boolean | null> {
      try {
        const { token } = await access(userId);
        return (await api.findDirectMessage(token, email)) === null;
      } catch {
        return null;
      }
    },

    /** Called only by the approval layer, after the click and the 30 s window. */
    async send(userId: string, target: ChatTarget, text: string): Promise<{ name: string }> {
      const { token } = await access(userId);
      if (!text.trim()) throw validationError("The message is empty.");
      let spaceName: string;
      if (target.kind === "person") {
        const direct = (await api.findDirectMessage(token, target.email).catch(explain)) ?? (await api.setupDirectMessage(token, target.email).catch(explain));
        spaceName = direct.name;
      } else {
        spaceName = target.space;
      }
      return api.sendMessage(token, spaceName, text).catch(explain);
    },
  };
}

export type GoogleChatService = ReturnType<typeof createGoogleChatService>;

let shared: GoogleChatService | null = null;
/** One per process, so the directory cache is shared. */
export function getGoogleChatService(): GoogleChatService {
  shared ??= createGoogleChatService();
  return shared;
}
