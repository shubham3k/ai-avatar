import { redact } from "../../domain/privacy/redaction.js";
import type { ChatTurnMessage, LlmProvider } from "./llm-provider.js";

/**
 * ADR-006 §1: every outgoing request passes through here, so sensitive
 * details (passwords, OTPs, card/bank/ID numbers) are masked before they
 * reach any AI provider — chat, reminder parsing, and prioritization alike.
 * One wrapper at the provider boundary instead of trusting each caller.
 * (Transcription sends audio, which can't be redacted; its *text* output is
 * redacted when it's used in a later request.)
 */
export function withRedaction(provider: LlmProvider): LlmProvider {
  const redactMessage = (message: ChatTurnMessage): ChatTurnMessage => ({ ...message, content: redact(message.content) });

  return {
    createStructuredCompletion: (request) =>
      provider.createStructuredCompletion({
        ...request,
        instructions: redact(request.instructions),
        input: redact(request.input),
      }),
    transcribeAudio: (request) => provider.transcribeAudio(request),
    streamChat: (request, onTextDelta) =>
      provider.streamChat({ ...request, messages: request.messages.map(redactMessage) }, onTextDelta),
  };
}
