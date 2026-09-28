import { describe, expect, it, vi } from "vitest";
import { createPrioritizationService } from "./prioritization.service.js";
import type { GroqProvider } from "../../providers/groq/groq-client.js";
import type { PrioritizationInput } from "./prioritization.types.js";

function makeInput(overrides: Partial<PrioritizationInput> = {}): PrioritizationInput {
  return {
    generatedAt: "2026-09-14T12:00:00.000Z",
    situations: [
      {
        situationId: "s1",
        relationship: { type: "attendee_match", strength: "strong" },
        email: {
          fromEmail: "john@acme.com",
          subject: "Acme proposal feedback",
          snippet: "notes",
          receivedAt: "2026-09-14T11:00:00.000Z",
        },
        calendarEvent: {
          summary: "Acme proposal review",
          startAt: "2026-09-15T10:00:00.000Z",
          endAt: "2026-09-15T11:00:00.000Z",
          attendeeEmails: ["john@acme.com"],
        },
        signals: [
          { id: "email_signal", sourceType: "email", confidence: "medium", dueAt: null },
          {
            id: "calendar_signal",
            sourceType: "calendar_event",
            confidence: "high",
            dueAt: "2026-09-15T10:00:00.000Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeProvider(overrides: Partial<GroqProvider> = {}): GroqProvider {
  return {
    createStructuredCompletion: vi.fn().mockResolvedValue(
      JSON.stringify({
        prioritizedSituations: [
          {
            situationId: "s1",
            priority: "high",
            reason: "Meeting is soon and the email requests feedback beforehand.",
            recommendedAction: "Reply with feedback before the meeting.",
          },
        ],
      }),
    ),
    transcribeAudio: vi.fn(),
    ...overrides,
  };
}

describe("prioritization service", () => {
  it("returns an empty result without calling the provider when there are no situations", async () => {
    const provider = makeProvider();
    const service = createPrioritizationService({ provider });

    const result = await service.prioritize(makeInput({ situations: [] }));

    expect(result).toEqual({ ok: true, prioritizedSituations: [] });
    expect(provider.createStructuredCompletion).not.toHaveBeenCalled();
  });

  it("returns a validated prioritization result for a valid AI response", async () => {
    const service = createPrioritizationService({ provider: makeProvider() });

    const result = await service.prioritize(makeInput());

    expect(result).toEqual({
      ok: true,
      prioritizedSituations: [
        {
          situationId: "s1",
          priority: "high",
          reason: "Meeting is soon and the email requests feedback beforehand.",
          recommendedAction: "Reply with feedback before the meeting.",
        },
      ],
    });
  });

  it("handles multiple situations", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi.fn().mockResolvedValue(
        JSON.stringify({
          prioritizedSituations: [
            { situationId: "s1", priority: "high", reason: "r1", recommendedAction: "a1" },
            { situationId: "s2", priority: "low", reason: "r2", recommendedAction: "a2" },
          ],
        }),
      ),
    });
    const input = makeInput({
      situations: [
        ...makeInput().situations,
        { ...makeInput().situations[0]!, situationId: "s2" },
      ],
    });

    const result = await createPrioritizationService({ provider }).prioritize(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prioritizedSituations.map((s) => s.situationId)).toEqual(["s1", "s2"]);
    }
  });

  it("drops an entry referencing a situationId that was never in the input", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi.fn().mockResolvedValue(
        JSON.stringify({
          prioritizedSituations: [
            { situationId: "s1", priority: "high", reason: "r", recommendedAction: "a" },
            { situationId: "invented-id", priority: "high", reason: "r", recommendedAction: "a" },
          ],
        }),
      ),
    });

    const result = await createPrioritizationService({ provider }).prioritize(makeInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prioritizedSituations).toHaveLength(1);
      expect(result.prioritizedSituations[0]?.situationId).toBe("s1");
    }
  });

  it("drops an entry with an invalid priority value", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi.fn().mockResolvedValue(
        JSON.stringify({
          prioritizedSituations: [
            { situationId: "s1", priority: "urgent!!", reason: "r", recommendedAction: "a" },
          ],
        }),
      ),
    });

    const result = await createPrioritizationService({ provider }).prioritize(makeInput());

    expect(result).toEqual({ ok: true, prioritizedSituations: [] });
  });

  it("returns malformed_output when the response is not valid JSON", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi.fn().mockResolvedValue("not json at all"),
    });

    const result = await createPrioritizationService({ provider }).prioritize(makeInput());

    expect(result).toMatchObject({ ok: false, code: "malformed_output" });
  });

  it("returns malformed_output when the JSON doesn't match the expected shape", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi.fn().mockResolvedValue(JSON.stringify({ wrong: "shape" })),
    });

    const result = await createPrioritizationService({ provider }).prioritize(makeInput());

    expect(result).toMatchObject({ ok: false, code: "malformed_output" });
  });

  it("returns malformed_output when an item is missing required fields", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi.fn().mockResolvedValue(
        JSON.stringify({ prioritizedSituations: [{ situationId: "s1" }] }),
      ),
    });

    const result = await createPrioritizationService({ provider }).prioritize(makeInput());

    expect(result).toMatchObject({ ok: false, code: "malformed_output" });
  });

  it("returns not_configured when the provider reports missing configuration", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi
        .fn()
        .mockRejectedValue(new Error("Groq is not configured. Set GROQ_API_KEY.")),
    });

    const result = await createPrioritizationService({ provider }).prioritize(makeInput());

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("returns provider_error on a generic provider failure, without leaking the raw message", async () => {
    const provider = makeProvider({
      createStructuredCompletion: vi
        .fn()
        .mockRejectedValue(new Error("upstream 503 diagnostic dump with internal details")),
    });

    const result = await createPrioritizationService({ provider }).prioritize(makeInput());

    expect(result).toMatchObject({ ok: false, code: "provider_error" });
    if (!result.ok) {
      expect(result.message).not.toMatch(/internal details/);
    }
  });

  it("constructs the request deterministically: same input produces the same provider call", async () => {
    const provider = makeProvider();
    const service = createPrioritizationService({ provider });
    const input = makeInput();

    await service.prioritize(input);
    await service.prioritize(input);

    const calls = (provider.createStructuredCompletion as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0].input).toBe(calls[1]![0].input);
  });

  it("sends only the known situationIds as the JSON schema enum (bounded input)", async () => {
    const provider = makeProvider();
    await createPrioritizationService({ provider }).prioritize(makeInput());

    const call = (provider.createStructuredCompletion as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.jsonSchema.properties.prioritizedSituations.items.properties.situationId.enum).toEqual(
      ["s1"],
    );
  });
});
