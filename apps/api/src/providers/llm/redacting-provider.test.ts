import { describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "./llm-provider.js";
import { withRedaction } from "./redacting-provider.js";

function spyProvider(): LlmProvider {
  return {
    createStructuredCompletion: vi.fn().mockResolvedValue("{}"),
    transcribeAudio: vi.fn().mockResolvedValue("text"),
    streamChat: vi.fn().mockResolvedValue({ content: "", toolCalls: [], provider: "openai" }),
  };
}

describe("withRedaction (ADR-006 §1)", () => {
  it("masks sensitive details in every chat message before it reaches the provider", async () => {
    const inner = spyProvider();
    await withRedaction(inner).streamChat(
      {
        messages: [
          { role: "system", content: "You are Zara." },
          { role: "user", content: "my otp is 482913, set a reminder" },
          { role: "tool", toolCallId: "c1", content: '{"snippet":"Your verification code 55213"}' },
        ],
        tools: [],
      },
      () => {},
    );

    const sent = (inner.streamChat as ReturnType<typeof vi.fn>).mock.calls[0]![0].messages;
    expect(sent[1].content).toBe("my otp is [redacted], set a reminder");
    expect(sent[2].content).toBe('{"snippet":"Your verification code [redacted]"}');
    expect(JSON.stringify(sent)).not.toMatch(/482913|55213/);
  });

  it("masks structured-completion input too (reminder parsing, prioritization)", async () => {
    const inner = spyProvider();
    await withRedaction(inner).createStructuredCompletion({
      instructions: "sys",
      input: JSON.stringify({ text: "remind me to renew card 4111 1111 1111 1111" }),
      schemaName: "x",
      jsonSchema: {},
    });

    const sent = (inner.createStructuredCompletion as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sent.input).not.toContain("4111");
  });
});
