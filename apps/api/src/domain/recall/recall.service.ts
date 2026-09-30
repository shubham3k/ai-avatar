import { createHash } from "node:crypto";
import type { PrismaClient, RecallSettings } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { decodeStringArray } from "../../lib/json-array.js";
import { createEmailsRepository } from "../../db/repositories/emails.repository.js";
import {
  createGmailHistoryService,
  type GmailHistoryService,
} from "../../providers/google/gmail/gmail-sent.service.js";
import { createGoogleConnectionService, type GoogleConnectionService } from "../google-connection.service.js";
import { toEmailInput } from "../gmail-sync.service.js";
import { clockLabel, shortDayLabel } from "../proactive/local-time.js";
import { attendeeLabels, meetingPeople } from "../proactive/meeting-brief.js";
import { chunkText } from "./chunker.js";
import {
  defaultDocumentsFolder,
  ensureDocumentsFolder,
  listDocumentFiles,
  readDocumentText,
  titleFromPath,
} from "./documents.js";
import { createLocalEmbedder, type Embedder } from "./embedder.js";
import {
  createRecallStore,
  RECALL_SOURCE_TYPES,
  type NewChunk,
  type RecallHit,
  type RecallSourceType,
  type RecallStore,
} from "./recall-store.js";

const DAY_MS = 24 * 60 * 60_000;
/** Per run, so one index pass never ties up Gmail or the CPU for long. */
const GMAIL_FETCHES_PER_RUN = 60;
const EMBED_BATCH = 32;
const EMBED_BUDGET_MS = 3 * 60_000;
const EMAIL_QUERY_EXCLUDES = "-in:spam -in:trash -category:promotions -category:social";
/** Below this cosine similarity (e5), a "meaning" match is noise. */
export const MIN_SEMANTIC_SIMILARITY = 0.8;

export interface RecallSettingsDto {
  documentsFolder: string;
  documentsEnabled: boolean;
  peopleEnabled: boolean;
  emailHistoryDays: number;
}

export interface RecallStatus {
  state: "idle" | "indexing";
  lastIndexedAt: string | null;
  lastError: string | null;
  model: "idle" | "loading" | "ready" | "failed";
  modelError: string | null;
  sources: Partial<Record<RecallSourceType, number>>;
  chunks: number;
  embedded: number;
  emailHistoryComplete: boolean;
}

interface SourceDoc {
  sourceId: string;
  hash: string;
  /** Either ready chunks, or a loader — files are only read when they changed. */
  chunks?: NewChunk[];
  load?: () => Promise<NewChunk[]>;
}

function hash(...parts: (string | null | undefined)[]): string {
  return createHash("sha1").update(parts.map((part) => part ?? "").join("␞")).digest("hex");
}

function chunksFor(title: string, header: string, body: string, sourceDate: Date | null, url: string | null): NewChunk[] {
  const pieces = chunkText(body);
  const texts = pieces.length > 0 ? pieces : [""];
  return texts.map((piece, chunkIndex) => ({
    chunkIndex,
    title,
    text: [header, piece].filter(Boolean).join("\n"),
    sourceDate,
    url,
  }));
}

/**
 * ADR-006 M6 — recall: keeps a local search index over the user's email
 * (1 month by default, 3 optional), calendar, chats, memory, notes, and
 * documents folder, and searches it by keyword + meaning. Indexing runs in
 * the background (one pass at a time) and only re-processes what changed.
 * Nothing here calls an AI provider: embeddings come from the local model.
 */
export function createRecallService(dependencies?: {
  prisma?: PrismaClient;
  embedder?: Embedder;
  gmail?: GmailHistoryService;
  connection?: GoogleConnectionService;
  minSimilarity?: number;
}) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const store: RecallStore = createRecallStore(prisma);
  const embedder = dependencies?.embedder ?? createLocalEmbedder();
  const gmail = dependencies?.gmail ?? createGmailHistoryService();
  const connection = dependencies?.connection ?? createGoogleConnectionService();
  const emails = createEmailsRepository(prisma);
  const minSimilarity = dependencies?.minSimilarity ?? MIN_SEMANTIC_SIMILARITY;
  let running: Promise<void> | null = null;
  let lastError: string | null = null;

  async function getSettings(userId: string): Promise<RecallSettings> {
    return prisma.recallSettings.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  function toDto(settings: RecallSettings): RecallSettingsDto {
    return {
      documentsFolder: settings.documentsFolder ?? defaultDocumentsFolder(),
      documentsEnabled: settings.documentsEnabled,
      peopleEnabled: settings.peopleEnabled,
      emailHistoryDays: settings.emailHistoryDays,
    };
  }

  // ---------------- sources ----------------

  async function emailDocs(userId: string, days: number, now: Date): Promise<SourceDoc[]> {
    const rows = await prisma.email.findMany({
      where: { userId, receivedAt: { gte: new Date(now.getTime() - days * DAY_MS) } },
      orderBy: { receivedAt: "desc" },
      take: 5000,
    });
    return rows
      .filter((row) => {
        const labels = decodeStringArray(row.labels);
        return !labels.includes("SPAM") && !labels.includes("TRASH");
      })
      .map((row) => {
        const sent = decodeStringArray(row.labels).includes("SENT");
        const who = sent
          ? `Email you sent to ${decodeStringArray(row.toEmails).slice(0, 3).join(", ")}`
          : `Email from ${row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail}`;
        const header = `${who} · ${shortDayLabel(row.receivedAt)}\nSubject: ${row.subject}`;
        const body = row.bodyText ?? row.snippet ?? "";
        return {
          sourceId: row.id,
          hash: hash(row.subject, row.snippet, row.bodyText, String(sent)),
          chunks: chunksFor(row.subject, header, body, row.receivedAt, row.sourceUrl),
        };
      });
  }

  async function eventDocs(userId: string): Promise<SourceDoc[]> {
    const [rows, integration] = await Promise.all([
      prisma.calendarEvent.findMany({ where: { userId }, take: 3000 }),
      prisma.integration.findFirst({ where: { userId, provider: "google" }, select: { providerAccountEmail: true } }),
    ]);
    return rows.map((row) => {
      let attendees: { email: string | null; displayName: string | null; responseStatus: string | null }[] = [];
      try {
        attendees = row.attendees ? JSON.parse(row.attendees) : [];
      } catch {
        attendees = [];
      }
      const people = attendeeLabels(
        meetingPeople({ attendees, organizerEmail: row.organizerEmail, organizerName: row.organizerName }, integration?.providerAccountEmail ?? null),
      );
      const when = row.isAllDay ? `${shortDayLabel(row.startAt)} (all day)` : `${shortDayLabel(row.startAt)}, ${clockLabel(row.startAt)}–${clockLabel(row.endAt)}`;
      const header = [`Calendar event · ${when}`, people.length ? `With: ${people.join(", ")}` : "", row.location ? `Where: ${row.location}` : ""]
        .filter(Boolean)
        .join("\n");
      return {
        sourceId: row.id,
        hash: hash(row.title, row.description, row.location, when, people.join(","), row.status),
        chunks: chunksFor(row.title, header, row.description ?? "", row.startAt, row.sourceUrl),
      };
    });
  }

  async function chatDocs(userId: string): Promise<SourceDoc[]> {
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
      take: 2000,
    });
    return conversations.map((conversation) => {
      const transcript = conversation.messages.map((m) => `${m.role === "user" ? "You" : "Zara"}: ${m.content}`).join("\n");
      return {
        sourceId: conversation.id,
        hash: hash(String(conversation.messages.length), conversation.updatedAt.toISOString()),
        chunks: chunksFor(conversation.title, `Chat with Zara · ${shortDayLabel(conversation.updatedAt)}`, transcript, conversation.updatedAt, null),
      };
    });
  }

  async function memoryDocs(userId: string): Promise<SourceDoc[]> {
    const facts = await prisma.memoryFact.findMany({ where: { userId } });
    return facts.map((fact) => ({
      sourceId: fact.id,
      hash: hash(fact.content),
      chunks: [{ chunkIndex: 0, title: "Something Zara remembers", text: fact.content, sourceDate: fact.updatedAt, url: null }],
    }));
  }

  async function fileDocs(folder: string): Promise<{ notes: SourceDoc[]; documents: SourceDoc[] }> {
    await ensureDocumentsFolder(folder);
    const notes: SourceDoc[] = [];
    const documents: SourceDoc[] = [];
    for (const file of await listDocumentFiles(folder)) {
      (file.isNote ? notes : documents).push({
        sourceId: file.relativePath,
        hash: hash(file.fingerprint),
        load: async () => {
          const text = await readDocumentText(file.absolutePath).catch(() => "");
          const header = file.isNote ? "Note" : `Document · ${file.relativePath}`;
          return chunksFor(titleFromPath(file.relativePath), header, text, file.modifiedAt, file.absolutePath);
        },
      });
    }
    return { notes, documents };
  }

  /** Brings one source type in line with `docs`: re-chunks changed ones, drops vanished ones. */
  async function sync(userId: string, type: RecallSourceType, docs: SourceDoc[]): Promise<void> {
    const indexed = await store.indexedHashes(userId, type);
    const current = new Set<string>();
    for (const doc of docs) {
      current.add(doc.sourceId);
      if (indexed.get(doc.sourceId) === doc.hash) continue;
      const chunks = doc.chunks ?? (doc.load ? await doc.load() : []);
      await store.replaceSource(userId, type, doc.sourceId, doc.hash, chunks);
    }
    await store.removeSources(userId, type, [...indexed.keys()].filter((id) => !current.has(id)));
  }

  // ---------------- email history ----------------

  async function fetchBodies(userId: string, refreshToken: string, ids: string[], budget: { left: number }, now: Date) {
    if (ids.length === 0) return;
    const known = await prisma.email.findMany({
      where: { userId, providerMessageId: { in: ids }, bodyText: { not: null } },
      select: { providerMessageId: true },
    });
    const have = new Set(known.map((row) => row.providerMessageId));
    for (const id of ids) {
      if (have.has(id) || budget.left <= 0) continue;
      budget.left -= 1;
      const message = await gmail.getMessage(refreshToken, id);
      if (message) await emails.upsertEmail({ ...toEmailInput(userId, message, now), bodyText: message.bodyText });
    }
  }

  /** New mail's bodies, then one more page of history until `emailHistoryDays` is covered. */
  async function backfillEmail(userId: string, settings: RecallSettings, now: Date): Promise<void> {
    let refreshToken: string;
    try {
      refreshToken = await connection.getDecryptedRefreshToken(userId);
    } catch {
      return; // Google not connected — recall works on what's there.
    }
    const budget = { left: GMAIL_FETCHES_PER_RUN };
    const recent = await gmail.listMessageIds(refreshToken, { query: `newer_than:3d ${EMAIL_QUERY_EXCLUDES}`, pageToken: null, maxResults: 50 });
    await fetchBodies(userId, refreshToken, recent.ids, budget, now);

    if (settings.backfillDoneForDays === settings.emailHistoryDays) return;
    const page = await gmail.listMessageIds(refreshToken, {
      query: `newer_than:${settings.emailHistoryDays}d ${EMAIL_QUERY_EXCLUDES}`,
      pageToken: settings.backfillPageToken,
      maxResults: 50,
    });
    await fetchBodies(userId, refreshToken, page.ids, budget, now);
    if (budget.left <= 0 && page.ids.length > 0) return; // Resume this page next run.
    await prisma.recallSettings.update({
      where: { userId },
      data: page.nextPageToken
        ? { backfillPageToken: page.nextPageToken }
        : { backfillPageToken: null, backfillDoneForDays: settings.emailHistoryDays },
    });
  }

  // ---------------- embeddings ----------------

  async function embedPending(userId: string): Promise<void> {
    const deadline = Date.now() + EMBED_BUDGET_MS;
    while (Date.now() < deadline) {
      const batch = await store.unembedded(userId, EMBED_BATCH);
      if (batch.length === 0) return;
      const vectors = await embedder.embed(
        batch.map((chunk) => `${chunk.title}\n${chunk.text}`),
        "passage",
      );
      for (let i = 0; i < batch.length; i += 1) await store.setEmbedding(batch[i]!.id, vectors[i]!);
    }
  }

  async function indexOnce(userId: string, now: Date): Promise<void> {
    const settings = await getSettings(userId);
    await backfillEmail(userId, settings, now).catch((err: unknown) => {
      lastError = `Email history: ${err instanceof Error ? err.message.slice(0, 120) : "failed"}`;
    });
    await sync(userId, "email", await emailDocs(userId, settings.emailHistoryDays, now));
    await sync(userId, "event", await eventDocs(userId));
    await sync(userId, "chat", await chatDocs(userId));
    await sync(userId, "memory", await memoryDocs(userId));
    if (settings.documentsEnabled) {
      const files = await fileDocs(settings.documentsFolder ?? defaultDocumentsFolder());
      await sync(userId, "note", files.notes);
      await sync(userId, "document", files.documents);
    } else {
      await sync(userId, "note", []);
      await sync(userId, "document", []);
    }
    await prisma.recallSettings.update({ where: { userId }, data: { lastIndexedAt: now } });
    // Embeddings last: keyword search is already usable, and the model may still be downloading.
    await embedPending(userId).catch(() => undefined);
  }

  return {
    store,
    embedder,

    async settings(userId: string): Promise<RecallSettingsDto> {
      return toDto(await getSettings(userId));
    },

    async updateSettings(
      userId: string,
      patch: { documentsFolder?: string | null | undefined; documentsEnabled?: boolean | undefined; peopleEnabled?: boolean | undefined; emailHistoryDays?: number | undefined },
    ): Promise<RecallSettingsDto> {
      await getSettings(userId);
      const data = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      return toDto(await prisma.recallSettings.update({ where: { userId }, data }));
    },

    /** Starts a background pass (unless one is running) and returns immediately. */
    start(userId: string, now: Date = new Date()): { started: boolean } {
      if (running) return { started: false };
      lastError = null;
      running = indexOnce(userId, now)
        .catch((err: unknown) => {
          lastError = err instanceof Error ? err.message.slice(0, 200) : "Indexing failed.";
        })
        .finally(() => {
          running = null;
        });
      return { started: true };
    },

    /** For tests and callers that need the pass to finish. */
    async runNow(userId: string, now: Date = new Date()): Promise<void> {
      this.start(userId, now);
      await running;
    },

    async status(userId: string): Promise<RecallStatus> {
      const settings = await getSettings(userId);
      const counts = await store.counts(userId);
      return {
        state: running ? "indexing" : "idle",
        lastIndexedAt: settings.lastIndexedAt?.toISOString() ?? null,
        lastError,
        model: embedder.state(),
        modelError: embedder.error(),
        ...counts,
        emailHistoryComplete: settings.backfillDoneForDays === settings.emailHistoryDays,
      };
    },

    /** Keyword + meaning search. Meaning search joins in once the local model is ready. */
    async search(userId: string, query: string, options?: { types?: RecallSourceType[]; limit?: number }): Promise<RecallHit[]> {
      const settings = await getSettings(userId);
      let types = options?.types?.length ? options.types : RECALL_SOURCE_TYPES;
      if (!settings.documentsEnabled) types = types.filter((type) => type !== "document" && type !== "note");
      let queryVector: Float32Array | null = null;
      if (embedder.state() === "ready") {
        queryVector = (await embedder.embed([query], "query").catch(() => []))[0] ?? null;
      } else if (embedder.state() === "idle") {
        // First search wakes the model up; don't wait for a download here.
        void embedder.embed(["warm up"], "query").catch(() => undefined);
      }
      return store.search(userId, query, { types, queryVector, limit: options?.limit ?? 6, minSimilarity });
    },
  };
}

export type RecallService = ReturnType<typeof createRecallService>;

let shared: RecallService | null = null;
/** One indexer per process — the model and the "one pass at a time" guard are shared. */
export function getRecallService(): RecallService {
  shared ??= createRecallService();
  return shared;
}
