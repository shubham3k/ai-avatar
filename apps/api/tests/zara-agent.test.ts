import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { createZaraAgentService, MAX_AGENT_STEPS, type ChatEvent } from "../src/domain/chat/zara-agent.service.js";
import {
  LlmProviderError,
  type ChatRequest,
  type ChatResult,
  type LlmProvider,
} from "../src/providers/llm/llm-provider.js";

let userId: string;

async function cleanDb() {
  await prisma.chatMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.user.deleteMany({ where: { email: "agent@example.local" } });
}

type Turn = { text?: string; toolCalls?: ChatResult["toolCalls"]; provider?: "openai" | "groq" } | Error;

/** A provider that plays back scripted turns, streaming each turn's text in two chunks. */
function scriptedProvider(turns: Turn[]) {
  const requests: ChatRequest[] = [];
  const provider: LlmProvider = {
    createStructuredCompletion: vi.fn(),
    transcribeAudio: vi.fn(),
    streamChat: vi.fn(async (request: ChatRequest, onTextDelta: (delta: string) => void) => {
      requests.push(structuredClone(request));
      const turn = turns.shift();
      if (!turn) throw new Error("no scripted turn left");
      if (turn instanceof Error) throw turn;
      const text = turn.text ?? "";
      if (text) {
        onTextDelta(text.slice(0, Math.ceil(text.length / 2)));
        onTextDelta(text.slice(Math.ceil(text.length / 2)));
      }
      return { content: text, toolCalls: turn.toolCalls ?? [], provider: turn.provider ?? "openai" };
    }),
  };
  return { provider, requests };
}

async function send(provider: LlmProvider, text: string, conversationId?: string) {
  const events: ChatEvent[] = [];
  await createZaraAgentService({ provider }).sendMessage(userId, { conversationId, text }, (e) => events.push(e));
  return events;
}

describe("Zara agent loop (ADR-006 M2)", () => {
  beforeEach(async () => {
    await cleanDb();
    userId = (await prisma.user.create({ data: { email: "agent@example.local", displayName: "A", timezone: "UTC" } })).id;
  });
  afterAll(cleanDb);

  it("starts a conversation, streams the reply, and stores both messages", async () => {
    const { provider } = scriptedProvider([{ text: "Hi! How can I help?" }]);

    const events = await send(provider, "hello zara");

    expect(events[0]).toMatchObject({ type: "conversation", title: "hello zara" });
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe(
      "Hi! How can I help?",
    );
    expect(events.at(-1)).toMatchObject({ type: "done", message: { role: "assistant", content: "Hi! How can I help?", provider: "openai" } });
    const stored = await prisma.chatMessage.findMany({ orderBy: { createdAt: "asc" } });
    expect(stored.map((m) => [m.role, m.content])).toEqual([
      ["user", "hello zara"],
      ["assistant", "Hi! How can I help?"],
    ]);
  });

  it("runs a tool call, feeds the validated result back, then answers", async () => {
    await prisma.reminder.create({ data: { userId, text: "pay rent", dueAt: new Date(Date.now() + 3_600_000) } });
    const { provider, requests } = scriptedProvider([
      { toolCalls: [{ id: "call_1", name: "list_reminders", arguments: "{}" }] },
      { text: "You have one reminder: pay rent." },
    ]);

    const events = await send(provider, "what reminders do I have?");

    expect(events).toContainEqual({ type: "status", text: "Checking your reminders…" });
    const toolMessage = requests[1]!.messages.find((m) => m.role === "tool");
    expect(toolMessage).toMatchObject({ toolCallId: "call_1" });
    expect(JSON.parse((toolMessage as { content: string }).content).reminders[0].text).toBe("pay rent");
    // The model sees the tools on every turn.
    expect(requests[0]!.tools.map((t) => t.name)).toContain("create_reminder");
  });

  it("rejects invalid tool arguments without running the tool, and tells the model why", async () => {
    const { provider, requests } = scriptedProvider([
      { toolCalls: [{ id: "c1", name: "delete_reminder", arguments: '{"reminderId": 42}' }] },
      { toolCalls: [{ id: "c2", name: "format_disk", arguments: "{}" }] },
      { text: "Sorry, I couldn't do that." },
    ]);

    await send(provider, "delete it");

    const toolResults = requests.at(-1)!.messages.filter((m) => m.role === "tool").map((m) => JSON.parse((m as { content: string }).content));
    expect(toolResults[0]).toMatchObject({ error: "Invalid arguments." });
    expect(toolResults[1]).toMatchObject({ error: 'Unknown tool "format_disk".' });
  });

  it("stops after the step limit with a readable note", async () => {
    const loop = { toolCalls: [{ id: "x", name: "list_reminders", arguments: "{}" }] };
    const { provider } = scriptedProvider(Array.from({ length: MAX_AGENT_STEPS }, () => loop));

    const events = await send(provider, "loop forever");

    expect(events.at(-1)).toMatchObject({ type: "done", message: { content: expect.stringMatching(/more steps than I can handle/) } });
  });

  it("replays history for follow-ups in the same conversation", async () => {
    const first = scriptedProvider([{ text: "Your dentist is at 6:30." }]);
    const events = await send(first.provider, "when is my dentist?");
    const conversationId = (events[0] as { id: string }).id;

    const second = scriptedProvider([{ text: "Done." }]);
    await send(second.provider, "remind me 30 minutes before", conversationId);

    const replayed = second.requests[0]!.messages.map((m) => [m.role, "content" in m ? m.content : ""]);
    expect(replayed.slice(1)).toEqual([
      ["user", "when is my dentist?"],
      ["assistant", "Your dentist is at 6:30."],
      ["user", "remind me 30 minutes before"],
    ]);
  });

  it("labels a reply produced by the Groq fallback", async () => {
    const { provider } = scriptedProvider([{ text: "Backup here.", provider: "groq" }]);
    const events = await send(provider, "hi");
    expect(events.at(-1)).toMatchObject({ type: "done", message: { provider: "groq" } });
  });

  it("reports a provider failure as a friendly error and stores no reply", async () => {
    const { provider } = scriptedProvider([new LlmProviderError("auth_rejected", "bad", "HTTP 401", "openai")]);

    const events = await send(provider, "hi");

    expect(events.at(-1)).toEqual({ type: "error", message: "Your OpenAI API key was rejected. Update it in Settings." });
    expect(await prisma.chatMessage.count({ where: { role: "assistant" } })).toBe(0);
  });

  it("refuses another user's conversation", async () => {
    const other = await prisma.user.create({ data: { email: "agent-other@example.local", displayName: "B", timezone: "UTC" } });
    const theirs = await prisma.conversation.create({ data: { userId: other.id, title: "private" } });
    const { provider } = scriptedProvider([{ text: "nope" }]);

    await expect(send(provider, "hi", theirs.id)).rejects.toMatchObject({ statusCode: 404 });
    await prisma.conversation.delete({ where: { id: theirs.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});
