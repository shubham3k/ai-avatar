import { mkdtemp, readFile, rm, unlink, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { createActivityService } from "../src/domain/activity/activity.service.js";
import { chunkText } from "../src/domain/recall/chunker.js";
import { createHashingEmbedder } from "../src/domain/recall/embedder.js";
import { createPeopleService } from "../src/domain/recall/people.service.js";
import { toFtsQuery } from "../src/domain/recall/recall-store.js";
import { createRecallService } from "../src/domain/recall/recall.service.js";
import { reciprocalRankFusion, decodeVector, encodeVector } from "../src/domain/recall/vector.js";
import { findTool, type ToolContext } from "../src/domain/chat/zara-tools.js";
import type { GmailHistoryService, SentGmailMessage } from "../src/providers/google/gmail/gmail-sent.service.js";

const USER_EMAIL = "recall@example.local";
let userId: string;
let folder: string;
const DAY = 86_400_000;
const now = new Date("2026-09-29T12:00:00Z");

async function cleanDb() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) return;
  await prisma.recallChunk.deleteMany({ where: { userId: user.id } });
  await prisma.recallSettings.deleteMany({ where: { userId: user.id } });
  await prisma.memoryFact.deleteMany({ where: { userId: user.id } });
  await prisma.activityEntry.deleteMany({ where: { userId: user.id } });
  await prisma.chatMessage.deleteMany({ where: { conversation: { userId: user.id } } });
  await prisma.conversation.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

const noGoogle = { getDecryptedRefreshToken: vi.fn().mockRejectedValue(new Error("not connected")) } as never;
const noGmail: GmailHistoryService = { listMessageIds: vi.fn(), getMessage: vi.fn() };

function service(overrides: { gmail?: GmailHistoryService; connection?: never } = {}) {
  return createRecallService({
    embedder: createHashingEmbedder(),
    gmail: overrides.gmail ?? noGmail,
    connection: overrides.connection ?? noGoogle,
    minSimilarity: 0.2,
  });
}

async function seed() {
  await prisma.email.create({
    data: {
      userId,
      providerMessageId: "e1",
      threadId: "t1",
      fromEmail: "rahul@acme.com",
      fromName: "Rahul Sharma",
      toEmails: '["me@example.com"]',
      subject: "Q3 budget numbers",
      snippet: "Here are the numbers",
      bodyText: "Hi, the Q3 budget is 12 lakh. Marketing gets 4 lakh. Please review before Friday.",
      receivedAt: new Date(now.getTime() - 3 * DAY),
      labels: '["INBOX"]',
      sourceUrl: "https://mail.google.com/mail/u/0/#all/e1",
    },
  });
  await prisma.calendarEvent.create({
    data: {
      userId,
      providerEventId: "ev1",
      calendarId: "primary",
      title: "Launch planning",
      description: "Discuss the website launch checklist",
      startAt: new Date(now.getTime() + DAY),
      endAt: new Date(now.getTime() + DAY + 3_600_000),
      attendeeEmails: '["rahul@acme.com"]',
      attendees: JSON.stringify([{ email: "rahul@acme.com", displayName: "Rahul Sharma", responseStatus: "accepted" }]),
    },
  });
  const conversation = await prisma.conversation.create({ data: { userId, title: "Vendor talk" } });
  await prisma.chatMessage.create({ data: { conversationId: conversation.id, role: "user", content: "The printing vendor quoted 30 thousand" } });
  await prisma.memoryFact.create({ data: { userId, content: "Rahul is the user's manager", category: "people" } });
  await mkdir(join(folder, "Notes"), { recursive: true });
  await writeFile(join(folder, "Notes", "Launch ideas.md"), "# Launch ideas\n\n- Send the press kit to Priya by Friday\n- Book the venue");
  await writeFile(join(folder, "contract.txt"), "Service agreement. The monthly retainer is 50,000 rupees, payable on the 5th.");
}

beforeEach(async () => {
  await cleanDb();
  userId = (await prisma.user.create({ data: { email: USER_EMAIL, displayName: "R", timezone: "UTC" } })).id;
  folder = await mkdtemp(join(tmpdir(), "zara-recall-"));
  await prisma.recallSettings.create({ data: { userId, documentsFolder: folder } });
});
afterAll(async () => {
  await cleanDb();
});

describe("recall building blocks (M6)", () => {
  it("chunks long text with overlap, short text as one piece", () => {
    expect(chunkText("short note")).toEqual(["short note"]);
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about something.`).join(" ");
    const chunks = chunkText(long, 300, 50);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300);
  });

  it("builds safe keyword queries (no FTS operators from user text)", () => {
    expect(toFtsQuery('budget" OR NOT x')).toBe('"budget"* OR "or"* OR "not"*');
    expect(toFtsQuery("कल मीटिंग")).toBe('"कल"* OR "मीटिंग"*');
    expect(toFtsQuery("a ?")).toBeNull();
  });

  it("round-trips vectors and fuses rankings", () => {
    expect([...decodeVector(encodeVector([0.5, -1, 2]))]).toEqual([0.5, -1, 2]);
    const fused = reciprocalRankFusion([["a", "b"], ["b", "c"]]);
    expect([...fused].sort((x, y) => y[1] - x[1])[0]![0]).toBe("b");
  });
});

describe("recall index and search (M6)", () => {
  it("indexes every source and finds things by keyword and meaning", async () => {
    await seed();
    const recall = service();
    await recall.runNow(userId, now);

    const status = await recall.status(userId);
    expect(status.sources).toMatchObject({ email: 1, event: 1, chat: 1, memory: 1, note: 1, document: 1 });
    expect(status.embedded).toBe(status.chunks);

    const budget = await recall.search(userId, "what is the Q3 budget?");
    expect(budget[0]).toMatchObject({ sourceType: "email", title: "Q3 budget numbers" });
    expect(budget[0]!.text).toContain("12 lakh");

    const retainer = await recall.search(userId, "monthly retainer amount");
    expect(retainer[0]).toMatchObject({ sourceType: "document", title: "contract" });

    const notes = await recall.search(userId, "press kit", { types: ["note"] });
    expect(notes.map((hit) => hit.title)).toEqual(["Launch ideas"]);
  });

  it("re-indexes only what changed, and drops what disappeared", async () => {
    await seed();
    const recall = service();
    await recall.runNow(userId, now);
    const before = await prisma.recallChunk.findFirstOrThrow({ where: { userId, sourceType: "email" } });

    await writeFile(join(folder, "contract.txt"), "Service agreement. The retainer is now 60,000 rupees.");
    await unlink(join(folder, "Notes", "Launch ideas.md"));
    await recall.runNow(userId, new Date(now.getTime() + 60_000));

    const after = await prisma.recallChunk.findFirstOrThrow({ where: { userId, sourceType: "email" } });
    expect(after.id).toBe(before.id); // untouched
    expect((await recall.search(userId, "retainer"))[0]!.text).toContain("60,000");
    expect(await prisma.recallChunk.count({ where: { userId, sourceType: "note" } })).toBe(0);
  });

  it("switching documents off removes them from the index", async () => {
    await seed();
    const recall = service();
    await recall.runNow(userId, now);
    await recall.updateSettings(userId, { documentsEnabled: false });
    await recall.runNow(userId, now);
    expect(await prisma.recallChunk.count({ where: { userId, sourceType: { in: ["note", "document"] } } })).toBe(0);
    expect(await recall.search(userId, "retainer")).toEqual([]);
  });

  it("backfills a month of email bodies page by page, then stops", async () => {
    const message = (id: string, daysAgo: number): SentGmailMessage => ({
      id,
      threadId: `t-${id}`,
      subject: `Subject ${id}`,
      from: "Priya <priya@acme.com>",
      to: "me@example.com",
      date: new Date(now.getTime() - daysAgo * DAY).toISOString(),
      snippet: "snippet",
      labels: ["INBOX"],
      internalDate: String(now.getTime() - daysAgo * DAY),
      bodyText: `Body of ${id} about the offsite in Goa`,
    });
    const gmail: GmailHistoryService = {
      listMessageIds: vi.fn(async (_token: string, { query, pageToken }: { query: string; pageToken: string | null }) => {
        if (query.startsWith("newer_than:3d")) return { ids: ["m1"], nextPageToken: null };
        return pageToken === "p2" ? { ids: ["m3"], nextPageToken: null } : { ids: ["m1", "m2"], nextPageToken: "p2" };
      }),
      getMessage: vi.fn(async (_token, id) => message(id, id === "m3" ? 20 : 2)),
    };
    const recall = service({ gmail, connection: { getDecryptedRefreshToken: vi.fn().mockResolvedValue("tok") } as never });

    await recall.runNow(userId, now);
    expect(gmail.getMessage).toHaveBeenCalledTimes(2); // m1 (recent), m2 (m1 already has a body)
    expect((await prisma.recallSettings.findUniqueOrThrow({ where: { userId } })).backfillPageToken).toBe("p2");

    await recall.runNow(userId, now);
    const settings = await prisma.recallSettings.findUniqueOrThrow({ where: { userId } });
    expect(settings).toMatchObject({ backfillPageToken: null, backfillDoneForDays: 30 });
    expect((await recall.status(userId)).emailHistoryComplete).toBe(true);
    expect((await recall.search(userId, "offsite Goa")).length).toBe(3);

    (gmail.listMessageIds as ReturnType<typeof vi.fn>).mockClear();
    await recall.runNow(userId, now);
    expect(gmail.listMessageIds).toHaveBeenCalledTimes(1); // only the recent-mail check
  });
});

describe("people profiles and notes (M6)", () => {
  it("builds a profile from local email, calendar, and memory", async () => {
    await seed();
    const profile = await createPeopleService().profile(userId, "rahul", now);
    expect(profile).toMatchObject({
      name: "Rahul Sharma",
      email: "rahul@acme.com",
      emailsFromThem: 1,
      recentSubjects: ["Q3 budget numbers"],
      notes: ["Rahul is the user's manager"],
    });
    expect(profile!.upcomingMeetings[0]).toMatch(/^Launch planning/);
    expect(await createPeopleService().profile(userId, "nobody-here", now)).toBeNull();
  });

  it("create_note writes a Markdown file, logs it, and undo deletes it", async () => {
    const recall = service();
    const activity = createActivityService();
    const context = {
      prisma,
      userId,
      now,
      turnState: new Map(),
      parseReminder: vi.fn(),
      memory: {} as never,
      incognito: false,
      recall,
      recordActivity: (entry: Parameters<ToolContext["recordActivity"]>[0]) => activity.record(userId, entry),
    } satisfies ToolContext;

    const result = (await findTool("create_note")!.run({ title: "Groceries: week 40", content: "- milk\n- atta" }, context)) as { file: string };

    expect(result.file).toBe(join(folder, "Notes", "Groceries week 40.md"));
    expect(await readFile(result.file, "utf-8")).toContain("- atta");
    const [entry] = await activity.list(userId);
    expect(entry).toMatchObject({ kind: "note_created", canUndo: true });
    await activity.undo(userId, entry!.id);
    expect(existsSync(result.file)).toBe(false);

    const incognito = await findTool("create_note")!.run({ title: "x", content: "y" }, { ...context, incognito: true });
    expect(incognito).toMatchObject({ error: expect.stringMatching(/incognito/) });
  });

  it("recall_search returns short snippets with refs, and read_recall_item more", async () => {
    await seed();
    const recall = service();
    await recall.runNow(userId, now);
    const context = { prisma, userId, now, turnState: new Map(), parseReminder: vi.fn(), memory: {} as never, incognito: false, recall, recordActivity: vi.fn() } satisfies ToolContext;

    const found = (await findTool("recall_search")!.run({ query: "marketing budget" }, context)) as { results: { ref: string; source: string; snippet: string }[] };
    expect(found.results[0]).toMatchObject({ source: "email" });
    expect(found.results[0]!.snippet.length).toBeLessThanOrEqual(400);
    const item = await findTool("read_recall_item")!.run({ ref: found.results[0]!.ref }, context);
    expect(item).toMatchObject({ source: "email", title: "Q3 budget numbers" });
  });
});

describe("recall routes (M6)", () => {
  it("rejects relative folders and reports status", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const headers = { "x-user-id": userId };
    try {
      const bad = await app.inject({ method: "PATCH", url: "/api/v1/recall/settings", headers, payload: { documentsFolder: "relative/path" } });
      expect(bad.statusCode).toBe(400);
      const badDays = await app.inject({ method: "PATCH", url: "/api/v1/recall/settings", headers, payload: { emailHistoryDays: 45 } });
      expect(badDays.statusCode).toBe(400);
      const status = await app.inject({ method: "GET", url: "/api/v1/recall/status", headers });
      expect(status.json()).toMatchObject({ model: expect.any(String), chunks: expect.any(Number) });
    } finally {
      await app.close();
      await rm(folder, { recursive: true, force: true });
    }
  }, 30_000);
});
