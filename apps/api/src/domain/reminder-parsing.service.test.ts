import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createReminderParsingService,
  REMINDER_FAILURE_MESSAGES,
} from "./reminder-parsing.service.js";
import { GroqProviderError, type GroqProvider } from "../providers/groq/groq-client.js";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Asia/Kolkata";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

// Friday 25 Sep 2026, 15:40 IST.
const NOW = new Date("2026-09-25T10:10:00.000Z");

function intentJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    reminderText: "Drink water",
    kind: "ping",
    timeType: "clock",
    relativeMinutes: null,
    date: null,
    time: "16:00",
    leadMinutes: null,
    ...overrides,
  });
}

function makeProvider(overrides: Partial<GroqProvider> = {}): GroqProvider {
  return {
    createStructuredCompletion: vi.fn().mockResolvedValue(intentJson()),
    transcribeAudio: vi.fn(),
    ...overrides,
  };
}

function serviceReturning(output: string) {
  return createReminderParsingService({
    provider: makeProvider({ createStructuredCompletion: vi.fn().mockResolvedValue(output) }),
  });
}

function serviceRejecting(err: unknown) {
  return createReminderParsingService({
    provider: makeProvider({ createStructuredCompletion: vi.fn().mockRejectedValue(err) }),
  });
}

describe("reminder parsing service — success", () => {
  it("turns a ping intent into an exact local-time reminder", async () => {
    const result = await createReminderParsingService({ provider: makeProvider() }).parse(
      "remind me to drink water at 4pm",
      NOW,
    );

    // 16:00 IST = 10:30 UTC, no lead time for a ping.
    expect(result).toEqual({
      ok: true,
      reminderText: "Drink water",
      dueAt: new Date("2026-09-25T10:30:00.000Z"),
      remindAt: new Date("2026-09-25T10:30:00.000Z"),
    });
  });

  it("gives an event a 10-minute heads-up", async () => {
    const result = await serviceReturning(
      intentJson({ reminderText: "Meeting", kind: "event", time: "17:00" }),
    ).parse("there is a meeting at 5pm", NOW);

    expect(result).toEqual({
      ok: true,
      reminderText: "Meeting",
      dueAt: new Date("2026-09-25T11:30:00.000Z"),
      remindAt: new Date("2026-09-25T11:20:00.000Z"),
    });
  });

  it("sends local time with offset (not UTC) and the raw text to the provider", async () => {
    const provider = makeProvider();
    await createReminderParsingService({ provider }).parse("remind me at 4pm", NOW);

    expect(provider.createStructuredCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        input: JSON.stringify({ now: "2026-09-25T15:40:00+05:30 (Friday)", text: "remind me at 4pm" }),
        schemaName: "reminder_parse_v2",
        maxOutputTokens: 300,
      }),
    );
  });

  it("trims the reminder text", async () => {
    const result = await serviceReturning(intentJson({ reminderText: "  call Rahul  " })).parse(
      "x",
      NOW,
    );
    expect(result).toMatchObject({ ok: true, reminderText: "call Rahul" });
  });

  it('labels a reminder that names no task ("remind me in 5 minutes") as "Reminder"', async () => {
    const result = await serviceReturning(
      intentJson({ reminderText: "  ", timeType: "relative", relativeMinutes: 5, time: null }),
    ).parse("remind me in 5 minutes", NOW);
    expect(result).toEqual({
      ok: true,
      reminderText: "Reminder",
      dueAt: new Date("2026-09-25T10:15:00.000Z"),
      remindAt: new Date("2026-09-25T10:15:00.000Z"),
    });
  });

  it('strips a leftover leading "to"', async () => {
    const result = await serviceReturning(intentJson({ reminderText: "to stretch" })).parse("x", NOW);
    expect(result).toMatchObject({ ok: true, reminderText: "stretch" });
  });
});

describe("reminder parsing service — provider failures", () => {
  it("maps a missing key to not_configured", async () => {
    const result = await serviceRejecting(
      new GroqProviderError("not_configured", "OpenAI is not configured.", null, "openai"),
    ).parse("x", NOW);
    expect(result).toEqual({
      ok: false,
      code: "not_configured",
      message: "Add your OpenAI API key in Settings to use reminders.",
    });
  });

  it("maps a rejected key to auth_rejected, naming the provider that rejected it", async () => {
    for (const [provider, label] of [["openai", "OpenAI"], ["groq", "Groq"]] as const) {
      const result = await serviceRejecting(
        new GroqProviderError("auth_rejected", "rejected", "HTTP 401", provider),
      ).parse("x", NOW);
      expect(result).toEqual({
        ok: false,
        code: "auth_rejected",
        message: `Your ${label} API key was rejected. Update it in Settings.`,
      });
    }
  });

  it("retries a transient failure once, then succeeds", async () => {
    const createStructuredCompletion = vi
      .fn()
      .mockRejectedValueOnce(new GroqProviderError("unavailable", "rate limited"))
      .mockResolvedValueOnce(intentJson());
    const service = createReminderParsingService({
      provider: makeProvider({ createStructuredCompletion }),
    });

    expect(await service.parse("x", NOW)).toMatchObject({ ok: true });
    expect(createStructuredCompletion).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rate-limit refusal", async () => {
    const createStructuredCompletion = vi
      .fn()
      .mockRejectedValue(new GroqProviderError("unavailable", "busy", "HTTP 429 rate_limit_exceeded"));
    const service = createReminderParsingService({
      provider: makeProvider({ createStructuredCompletion }),
    });

    expect(await service.parse("x", NOW)).toMatchObject({ ok: false, code: "provider_error" });
    expect(createStructuredCompletion).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rejected key", async () => {
    const createStructuredCompletion = vi
      .fn()
      .mockRejectedValue(new GroqProviderError("auth_rejected", "rejected"));
    const service = createReminderParsingService({
      provider: makeProvider({ createStructuredCompletion }),
    });

    expect(await service.parse("x", NOW)).toMatchObject({ ok: false, code: "auth_rejected" });
    expect(createStructuredCompletion).toHaveBeenCalledTimes(1);
  });

  it("reports a retired/unknown model distinctly, without retrying", async () => {
    const createStructuredCompletion = vi
      .fn()
      .mockRejectedValue(new GroqProviderError("model_unavailable", "model not found", "HTTP 404", "openai"));
    const service = createReminderParsingService({
      provider: makeProvider({ createStructuredCompletion }),
    });

    expect(await service.parse("x", NOW)).toEqual({
      ok: false,
      code: "model_unavailable",
      message:
        "The OpenAI model this app is set to use isn't available to your key. Choose another model in Settings. (OpenAI: HTTP 404)",
    });
    expect(createStructuredCompletion).toHaveBeenCalledTimes(1);
  });

  it("appends the failing provider's status/code so it can be diagnosed from the screen", async () => {
    const result = await serviceRejecting(
      new GroqProviderError("unavailable", "busy", "HTTP 429 rate_limit_exceeded", "groq"),
    ).parse("x", NOW);
    expect(result).toEqual({
      ok: false,
      code: "provider_error",
      message:
        "The AI service is busy or unreachable right now. Try again in a moment. (Groq: HTTP 429 rate_limit_exceeded)",
    });
  });

  it("maps persistent outages and unknown errors to provider_error", async () => {
    for (const err of [
      new GroqProviderError("unavailable", "Groq is temporarily unavailable."),
      new Error("boom"),
    ]) {
      expect(await serviceRejecting(err).parse("x", NOW)).toMatchObject({
        ok: false,
        code: "provider_error",
      });
    }
  });
});

describe("reminder parsing service — bad model output", () => {
  it.each([
    ["non-JSON output", "not json"],
    ["missing fields", JSON.stringify({ reminderText: "ok" })],
    ["an unknown kind", intentJson({ kind: "alarm" })],
    ["an unparseable time", intentJson({ time: "4pm" })],
  ])("returns malformed_output for %s", async (_label, output) => {
    expect(await serviceReturning(output).parse("x", NOW)).toMatchObject({
      ok: false,
      code: "malformed_output",
    });
  });

  it("asks for a time when none was given", async () => {
    const result = await serviceReturning(intentJson({ timeType: "none", time: null })).parse(
      "remind me to call Rahul",
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      code: "missing_time",
      message: REMINDER_FAILURE_MESSAGES.missing_time,
    });
  });

  it("rejects an explicit date that already passed", async () => {
    const result = await serviceReturning(intentJson({ date: "2026-09-20", time: "10:00" })).parse(
      "x",
      NOW,
    );
    expect(result).toMatchObject({ ok: false, code: "time_in_past" });
  });
});
