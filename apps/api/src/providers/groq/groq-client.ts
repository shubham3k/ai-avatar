import OpenAI from "openai";
import type { ResponseFormatJSONSchema } from "openai/resources/shared.js";
import { env } from "../../config/env.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "qwen/qwen3-32b";

export interface StructuredCompletionRequest {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}

export interface GroqProvider {
  /** Returns the raw JSON text produced by the model — not yet parsed/validated. */
  createStructuredCompletion(request: StructuredCompletionRequest): Promise<string>;
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Maps a Groq SDK error into a safe, generic Error — never leaks raw provider payloads. */
function mapGroqError(err: unknown): Error {
  const status = extractStatus(err);
  if (status === 401 || status === 403) {
    return new Error("Groq rejected the request credentials.");
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new Error("Groq is temporarily unavailable. Try again shortly.");
  }
  return new Error("Groq request failed.");
}

export function createGroqProvider(overrides?: {
  apiKey?: string;
  model?: string;
}): GroqProvider {
  const apiKey = overrides?.apiKey ?? env.GROQ_API_KEY;
  const model = overrides?.model ?? env.GROQ_MODEL ?? DEFAULT_MODEL;

  return {
    async createStructuredCompletion(request) {
      if (!apiKey) {
        throw new Error("Groq is not configured. Set GROQ_API_KEY.");
      }

      const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });

      let outputText: string | null | undefined;
      try {
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: request.instructions },
            { role: "user", content: request.input },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.schemaName,
              schema: request.jsonSchema,
              strict: true,
            },
          } satisfies ResponseFormatJSONSchema,
        });
        outputText = response.choices[0]?.message?.content;
      } catch (err) {
        throw mapGroqError(err);
      }

      if (!outputText) {
        throw new Error("Groq returned an empty response.");
      }
      return outputText;
    },
  };
}
