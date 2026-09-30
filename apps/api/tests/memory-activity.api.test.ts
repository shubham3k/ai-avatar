import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { prisma } from "../src/lib/prisma.js";
import { createActivityService } from "../src/domain/activity/activity.service.js";

const streamChat = vi.fn();

vi.mock("../src/providers/llm/create-llm-provider.js", () => ({
  createLlmProvider: () => ({ createStructuredCompletion: vi.fn(), transcribeAudio: vi.fn(), streamChat }),
}));

let userId: string;

function parseSse(body: string) {
  return body
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)));
}

describe("memory, activity log, chat deletion, incognito (ADR-006 M3)", () => {
  let app: FastifyInstance;
  const activity = createActivityService({ prisma });

  beforeEach(async () => {
    await prisma.activityEntry.deleteMany();
    await prisma.memoryFact.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.reminder.deleteMany();
    userId = (
      await prisma.user.upsert({
        where: { email: DEMO_USER_EMAIL },
        update: {},
        create: { email: DEMO_USER_EMAIL, displayName: "Demo User", timezone: "UTC" },
      })
    ).id;
    streamChat.mockReset();
    if (!app) {
      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
    }
  });

  afterAll(async () => {
    await prisma.activityEntry.deleteMany();
    await prisma.memoryFact.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.conversation.deleteMany();
    await app?.close();
  });

  describe("memory page endpoints", () => {
    it("lists, edits, and deletes facts; refuses sensitive edits", async () => {
      const fact = await prisma.memoryFact.create({ data: { userId, content: "Likes tea", category: "preferences" } });

      expect((await app.inject({ method: "GET", url: "/api/v1/memory/facts" })).json().facts).toEqual([
        expect.objectContaining({ id: fact.id, content: "Likes tea", category: "preferences" }),
      ]);

      const edited = await app.inject({ method: "PATCH", url: `/api/v1/memory/facts/${fact.id}`, payload: { content: "Likes green tea" } });
      expect(edited.json()).toMatchObject({ content: "Likes green tea" });

      const sensitive = await app.inject({
        method: "PATCH",
        url: `/api/v1/memory/facts/${fact.id}`,
        payload: { content: "password is hunter2" },
      });
      expect(sensitive.statusCode).toBe(400);

      expect((await app.inject({ method: "DELETE", url: `/api/v1/memory/facts/${fact.id}` })).statusCode).toBe(200);
      expect(await prisma.memoryFact.count()).toBe(0);
    });

    it("forgets everything", async () => {
      await prisma.memoryFact.createMany({
        data: [
          { userId, content: "a", category: "other" },
          { userId, content: "b", category: "other" },
        ],
      });
      expect((await app.inject({ method: "DELETE", url: "/api/v1/memory/facts" })).json()).toEqual({ deleted: 2 });
    });
  });

  describe("activity log + undo", () => {
    it("undoes a created reminder (deletes it) and marks the entry undone", async () => {
      const reminder = await prisma.reminder.create({ data: { userId, text: "gym", dueAt: new Date(Date.now() + 3_600_000) } });
      await activity.record(userId, { kind: "reminder_created", summary: "Set a reminder: gym", undo: { reminderId: reminder.id } });
      const [entry] = (await app.inject({ method: "GET", url: "/api/v1/activity" })).json().entries;
      expect(entry).toMatchObject({ summary: "Set a reminder: gym", canUndo: true });

      const undone = await app.inject({ method: "POST", url: `/api/v1/activity/${entry.id}/undo` });

      expect(undone.json()).toMatchObject({ canUndo: false, undoneAt: expect.any(String) });
      expect(await prisma.reminder.count()).toBe(0);
      expect((await app.inject({ method: "POST", url: `/api/v1/activity/${entry.id}/undo` })).statusCode).toBe(409);
    });

    it("undoes a deleted reminder (recreates it)", async () => {
      const dueAt = new Date(Date.now() + 3_600_000).toISOString();
      await activity.record(userId, {
        kind: "reminder_deleted",
        summary: "Deleted the reminder",
        undo: { text: "pay rent", dueAt, remindAt: null },
      });
      const [entry] = await activity.list(userId);

      await activity.undo(userId, entry!.id);

      expect(await prisma.reminder.findFirstOrThrow()).toMatchObject({ text: "pay rent" });
    });

    it("undoes memory saves, updates, and deletions", async () => {
      const fact = await prisma.memoryFact.create({ data: { userId, content: "new text", category: "people" } });
      await activity.record(userId, { kind: "memory_updated", summary: "u", undo: { factId: fact.id, previousContent: "old text" } });
      await activity.undo(userId, (await activity.list(userId))[0]!.id);
      expect((await prisma.memoryFact.findUniqueOrThrow({ where: { id: fact.id } })).content).toBe("old text");

      await activity.record(userId, { kind: "memory_saved", summary: "s", undo: { factId: fact.id } });
      await activity.undo(userId, (await activity.list(userId))[0]!.id);
      expect(await prisma.memoryFact.count()).toBe(0);

      await activity.record(userId, { kind: "memory_deleted", summary: "d", undo: { content: "Priya is the user's sister", category: "people" } });
      await activity.undo(userId, (await activity.list(userId))[0]!.id);
      expect(await prisma.memoryFact.findFirstOrThrow()).toMatchObject({ content: "Priya is the user's sister" });
    });

    it("reports a clear conflict when the thing to undo is already gone", async () => {
      await activity.record(userId, { kind: "reminder_created", summary: "s", undo: { reminderId: "gone" } });
      const res = await app.inject({ method: "POST", url: `/api/v1/activity/${(await activity.list(userId))[0]!.id}/undo` });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toBe("That reminder is already gone.");
    });

    it("clears the log", async () => {
      await activity.record(userId, { kind: "memory_saved", summary: "s", undo: { factId: "x" } });
      expect((await app.inject({ method: "DELETE", url: "/api/v1/activity" })).json()).toEqual({ deleted: 1 });
    });
  });

  describe("chats", () => {
    it("deletes one conversation, then all", async () => {
      const a = await prisma.conversation.create({ data: { userId, title: "a" } });
      await prisma.chatMessage.create({ data: { conversationId: a.id, role: "user", content: "hi" } });
      await prisma.conversation.create({ data: { userId, title: "b" } });

      expect((await app.inject({ method: "DELETE", url: `/api/v1/chat/conversations/${a.id}` })).statusCode).toBe(200);
      expect(await prisma.chatMessage.count()).toBe(0);
      expect((await app.inject({ method: "DELETE", url: "/api/v1/chat/conversations" })).json()).toEqual({ deleted: 1 });
    });

    it("incognito chats store nothing and use the client's history; memory tools aren't offered", async () => {
      streamChat.mockImplementation(async (_request, onTextDelta: (d: string) => void) => {
        onTextDelta("Sure!");
        return { content: "Sure!", toolCalls: [], provider: "openai" };
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/chat/messages",
        payload: {
          text: "and after that?",
          incognito: true,
          history: [
            { role: "user", content: "what's first today?" },
            { role: "assistant", content: "Standup at 10." },
          ],
        },
      });

      const events = parseSse(res.body);
      expect(events.map((e) => e.type)).toEqual(["delta", "done"]);
      expect(events.at(-1).message.id).toMatch(/^incognito-/);
      expect(await prisma.conversation.count()).toBe(0);
      expect(await prisma.chatMessage.count()).toBe(0);

      const request = streamChat.mock.calls[0]![0];
      expect(request.messages.slice(1).map((m: { content: string }) => m.content)).toEqual([
        "what's first today?",
        "Standup at 10.",
        "and after that?",
      ]);
      expect(request.tools.map((t: { name: string }) => t.name)).not.toContain("remember_fact");
      expect(request.messages[0].content).toMatch(/incognito chat/);
    });

    it("puts saved memory into Zara's context", async () => {
      await prisma.memoryFact.create({ data: { userId, content: "Rahul is the user's manager", category: "people" } });
      streamChat.mockResolvedValue({ content: "ok", toolCalls: [], provider: "openai" });

      await app.inject({ method: "POST", url: "/api/v1/chat/messages", payload: { text: "who is my manager?" } });

      expect(streamChat.mock.calls[0]![0].messages[0].content).toContain("Rahul is the user's manager");
    });
  });
});
