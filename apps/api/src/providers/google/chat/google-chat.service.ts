import { google } from "googleapis";
import { mapGoogleApiError } from "../google-api-error.js";
import { createGoogleOAuthService, type GoogleOAuthService } from "../oauth/google-oauth.service.js";

/**
 * ADR-006 §8a: Google Chat as the user (chat.* scopes). Reading happens only
 * when the user asks; sending is only ever called by the approval layer
 * after the user clicked Approve and the 30-second undo window passed.
 */
export interface ChatSpace {
  /** "spaces/AAAA…" */
  name: string;
  displayName: string;
  type: "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE";
}

export interface ChatMessage {
  /** "users/123…" (the Google account id), or null for messages from apps. */
  senderId: string | null;
  senderIsApp: boolean;
  text: string;
  createTime: string | null;
}

export interface DirectoryPerson {
  name: string | null;
  email: string | null;
}

export interface GoogleChatApi {
  /** The 1:1 chat with this person, or null if they've never chatted. */
  findDirectMessage(refreshToken: string, email: string): Promise<ChatSpace | null>;
  /** Opens a 1:1 chat with someone the user hasn't chatted with yet. */
  setupDirectMessage(refreshToken: string, email: string): Promise<ChatSpace>;
  /** Group spaces and group chats the user is in. */
  listSpaces(refreshToken: string): Promise<ChatSpace[]>;
  /** The newest messages of one chat, oldest first. */
  listMessages(refreshToken: string, spaceName: string, limit: number): Promise<ChatMessage[]>;
  sendMessage(refreshToken: string, spaceName: string, text: string): Promise<{ name: string }>;
  /** The user's Workspace directory, keyed by "users/<id>" (best effort — needs directory.readonly). */
  directory(refreshToken: string): Promise<Map<string, DirectoryPerson>>;
}

function statusOf(err: unknown): number | undefined {
  const candidate = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  for (const value of [candidate?.code, candidate?.status, candidate?.response?.status]) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

function toSpace(space: { name?: string | null; displayName?: string | null; spaceType?: string | null }): ChatSpace {
  const type = space.spaceType === "SPACE" || space.spaceType === "GROUP_CHAT" ? space.spaceType : "DIRECT_MESSAGE";
  return { name: space.name ?? "", displayName: space.displayName ?? "", type };
}

/** Addresses go into a resource name — keep them to plain email characters. */
function userAlias(email: string): string {
  return `users/${email.replace(/[^A-Za-z0-9.@_+-]/g, "")}`;
}

export function createGoogleChatApi(dependencies?: { oauth?: GoogleOAuthService }): GoogleChatApi {
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();
  const chat = (token: string) => google.chat({ version: "v1", auth: oauth.createAuthorizedClient(token) });

  return {
    async findDirectMessage(refreshToken, email) {
      try {
        const res = await chat(refreshToken).spaces.findDirectMessage({ name: userAlias(email) });
        return toSpace(res.data);
      } catch (err) {
        if (statusOf(err) === 404) return null;
        throw mapGoogleApiError(err, "Google Chat");
      }
    },

    async setupDirectMessage(refreshToken, email) {
      try {
        const res = await chat(refreshToken).spaces.setup({
          requestBody: {
            space: { spaceType: "DIRECT_MESSAGE" },
            memberships: [{ member: { name: userAlias(email), type: "HUMAN" } }],
          },
        });
        return toSpace(res.data);
      } catch (err) {
        throw mapGoogleApiError(err, "Google Chat");
      }
    },

    async listSpaces(refreshToken) {
      try {
        const spaces: ChatSpace[] = [];
        let pageToken: string | undefined;
        do {
          const res = await chat(refreshToken).spaces.list({
            pageSize: 100,
            filter: 'spaceType = "SPACE" OR spaceType = "GROUP_CHAT"',
            ...(pageToken ? { pageToken } : {}),
          });
          spaces.push(...(res.data.spaces ?? []).map(toSpace));
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken && spaces.length < 300);
        return spaces;
      } catch (err) {
        throw mapGoogleApiError(err, "Google Chat");
      }
    },

    async listMessages(refreshToken, spaceName, limit) {
      try {
        const res = await chat(refreshToken).spaces.messages.list({ parent: spaceName, pageSize: limit, orderBy: "createTime desc" });
        return (res.data.messages ?? [])
          .map((message) => ({
            senderId: message.sender?.name ?? null,
            senderIsApp: message.sender?.type === "BOT",
            text: message.text ?? message.formattedText ?? (message.attachment?.length ? "(attachment)" : ""),
            createTime: message.createTime ?? null,
          }))
          .reverse();
      } catch (err) {
        throw mapGoogleApiError(err, "Google Chat");
      }
    },

    async sendMessage(refreshToken, spaceName, text) {
      try {
        const res = await chat(refreshToken).spaces.messages.create({ parent: spaceName, requestBody: { text } });
        return { name: res.data.name ?? "" };
      } catch (err) {
        throw mapGoogleApiError(err, "Google Chat");
      }
    },

    async directory(refreshToken) {
      const people = google.people({ version: "v1", auth: oauth.createAuthorizedClient(refreshToken) });
      const result = new Map<string, DirectoryPerson>();
      let pageToken: string | undefined;
      do {
        const res = await people.people.listDirectoryPeople({
          readMask: "names,emailAddresses",
          sources: ["DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE"],
          pageSize: 1000,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const person of res.data.people ?? []) {
          const id = person.resourceName?.replace(/^people\//, "");
          if (!id) continue;
          result.set(`users/${id}`, {
            name: person.names?.[0]?.displayName ?? null,
            email: person.emailAddresses?.[0]?.value?.toLowerCase() ?? null,
          });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken && result.size < 5000);
      return result;
    },
  };
}
