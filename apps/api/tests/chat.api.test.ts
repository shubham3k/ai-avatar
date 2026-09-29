import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { prisma } from "../src/lib/prisma.js";

const streamChat = vi.fn();
const transcribeAudio = vi.fn();

vi.mock("../src/providers/llm/create-llm-provider.js", () => ({
  createLlmProvider: () => ({ createStructuredCompletion: vi.fn(), transcribeAudio, streamChat }),
}));

function parseSse(body: string) {
  return body
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)));
}

describe("chat API (ADR-006 M2)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await prisma.chatMessage.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.upsert({
      where: { email: DEMO_USER_EMAIL },
      update: {},
      create: { email: DEMO_USER_EMAIL, displayName: "Demo User", timezone: "UTC" },
    });
    streamChat.mockReset();
    transcribeAudio.mockReset();
    if (!app) {
      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
    }
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany();
    await prisma.conversation.deleteMany();
    await app?.close();
  });

  it("POST /chat/messages streams conversation, text deltas, and done as Server-Sent Events", async () => {
    streamChat.mockImplementation(async (_request, onTextDelta: (d: string) => void) => {
      onTextDelta("Hello ");
      onTextDelta("there!");
      return { content: "Hello there!", toolCalls: [], provider: "openai" };
    });

    const res = await app.inject({ method: "POST", url: "/api/v1/chat/messages", payload: { text: "hi" } });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const events = parseSse(res.body);
    expect(events.map((e) => e.type)).toEqual(["conversation", "delta", "delta", "done"]);
    expect(events.at(-1).message).toMatchObject({ role: "assistant", content: "Hello there!" });
  });

  it("lists conversations and returns a conversation's messages", async () => {
    streamChat.mockResolvedValue({ content: "Sure.", toolCalls: [], provider: "openai" });
    const first = parseSse(
      (await app.inject({ method: "POST", url: "/api/v1/chat/messages", payload: { text: "plan my day" } })).body,
    );
    const conversationId = first[0].id;

    const list = (await app.inject({ method: "GET", url: "/api/v1/chat/conversations" })).json();
    expect(list.conversations).toEqual([expect.objectContaining({ id: conversationId, title: "plan my day" })]);

    const messages = (
      await app.inject({ method: "GET", url: `/api/v1/chat/conversations/${conversationId}/messages` })
    ).json();
    expect(messages.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("returns a normal 404 (not a stream) for an unknown conversation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/chat/messages",
      payload: { conversationId: "does-not-exist", text: "hi" },
    });
    expect(res.statusCode).toBe(404);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/chat/messages", payload: { text: "   " } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /chat/transcribe returns the spoken text for the chat box", async () => {
    transcribeAudio.mockResolvedValue("  what's on my calendar today  ");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/chat/transcribe",
      payload: { audioBase64: Buffer.from("audio").toString("base64"), mimeType: "audio/webm", durationSeconds: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: "what's on my calendar today" });
  });
});
