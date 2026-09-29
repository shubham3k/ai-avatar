import { z } from "zod";
import { classifyLlmFailure, type LlmProvider } from "../../providers/llm/llm-provider.js";
import { providerFailureMessage } from "../llm-failure-messages.js";
import { createDefaultLlmProvider } from "../llm-usage.service.js";
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

export function createPrioritizationService(dependencies?: { provider?: LlmProvider }) {
  const provider = dependencies?.provider ?? createDefaultLlmProvider();

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
          operation: "prioritization",
        });
      } catch (err) {
        if (classifyLlmFailure(err) === "not_configured") {
          return {
            ok: false,
            code: "not_configured",
            message: providerFailureMessage("not_configured", err, "AI prioritization"),
          };
        }
        return {
          ok: false,
          code: "provider_error",
          message: providerFailureMessage("provider_error", err, "AI prioritization"),
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          ok: false,
          code: "malformed_output",
          message: "The AI returned a response that was not valid JSON.",
        };
      }

      const shapeResult = rawPrioritizationSchema.safeParse(parsed);
      if (!shapeResult.success) {
        return {
          ok: false,
          code: "malformed_output",
          message: "The AI response did not match the expected prioritization shape.",
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
