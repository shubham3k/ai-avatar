import { z } from "zod";
import {
  createGroqProvider,
  type GroqProvider,
} from "../../providers/groq/groq-client.js";
import {
  PRIORITIZATION_SYSTEM_PROMPT,
  PRIORITIZATION_PROMPT_VERSION,
} from "../../providers/groq/prioritization-prompt.js";
import { buildPrioritizationJsonSchema } from "../../providers/groq/prioritization-schema.js";
import type {
  PrioritizationInput,
  PrioritizationOutcome,
  PriorityLevel,
} from "./prioritization.types.js";

const PRIORITY_LEVELS: readonly PriorityLevel[] = ["high", "medium", "low"];

// Deliberately loose: only checks the raw shape came back with the right
// keys/types. Whether situationId/priority are actually *valid* (known ID,
// allowed enum value) is checked separately below, entry by entry, so one
// bad item doesn't invalidate an otherwise-good response.
const rawPrioritizationSchema = z.object({
  prioritizedSituations: z.array(
    z.object({
      situationId: z.string(),
      priority: z.string(),
      reason: z.string(),
      recommendedAction: z.string(),
    }),
  ),
});

export function createPrioritizationService(dependencies?: { provider?: GroqProvider }) {
  const provider = dependencies?.provider ?? createGroqProvider();

  return {
    async prioritize(input: PrioritizationInput): Promise<PrioritizationOutcome> {
      if (input.situations.length === 0) {
        return { ok: true, prioritizedSituations: [] };
      }

      const knownIds = new Set(input.situations.map((s) => s.situationId));

      let raw: string;
      try {
        raw = await provider.createStructuredCompletion({
          instructions: PRIORITIZATION_SYSTEM_PROMPT,
          input: JSON.stringify(input),
          schemaName: `prioritization_result_${PRIORITIZATION_PROMPT_VERSION}`,
          jsonSchema: buildPrioritizationJsonSchema([...knownIds]),
          // Ranked situations with one-line reasons; an oversized reply fails Zod
          // validation and is reported like any other malformed output.
          maxOutputTokens: 800,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Groq request failed.";
        if (/not configured/i.test(message)) {
          return { ok: false, code: "not_configured", message };
        }
        return {
          ok: false,
          code: "provider_error",
          message: "Groq prioritization is temporarily unavailable. Try again shortly.",
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          ok: false,
          code: "malformed_output",
          message: "Groq returned a response that was not valid JSON.",
        };
      }

      const shapeResult = rawPrioritizationSchema.safeParse(parsed);
      if (!shapeResult.success) {
        return {
          ok: false,
          code: "malformed_output",
          message: "Groq response did not match the expected prioritization shape.",
        };
      }

      // Defense in depth: even though the JSON schema constrains these at
      // generation time, never trust the provider blindly — silently drop
      // any entry referencing an unknown situationId or an out-of-enum
      // priority rather than propagating it or failing the whole batch.
      const prioritizedSituations = shapeResult.data.prioritizedSituations.filter(
        (item): item is { situationId: string; priority: PriorityLevel; reason: string; recommendedAction: string } =>
          knownIds.has(item.situationId) &&
          (PRIORITY_LEVELS as readonly string[]).includes(item.priority),
      );

      return { ok: true, prioritizedSituations };
    },
  };
}

export type PrioritizationService = ReturnType<typeof createPrioritizationService>;
