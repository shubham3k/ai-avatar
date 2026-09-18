/**
 * Builds the JSON Schema handed to Groq's Structured Outputs feature for
 * this request. situationId is constrained to an enum of the *actual*
 * situation IDs in this request, so the model is structurally prevented
 * from inventing an ID — not just asked nicely not to.
 */
export function buildPrioritizationJsonSchema(situationIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      prioritizedSituations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            situationId: { type: "string", enum: situationIds },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            reason: { type: "string" },
            recommendedAction: { type: "string" },
          },
          required: ["situationId", "priority", "reason", "recommendedAction"],
        },
      },
    },
    required: ["prioritizedSituations"],
  } as const;
}
