import { describe, expect, it } from "vitest";
import {
  buildDailyContextPrioritizationInput,
  buildPrioritizationInput,
} from "./prioritization-input.builder.js";
import type { ConsolidatedSituation } from "../context/consolidated-situation.types.js";
import type { DailyAssistantContext } from "../daily-context/daily-context.types.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeSituation(overrides: Partial<ConsolidatedSituation> = {}): ConsolidatedSituation {
  return {
    id: "email_signal:calendar_signal",
    signalIds: ["email_signal", "calendar_signal"],
    primarySignalId: "calendar_signal",
    emailIds: ["email_1"],
    calendarEventIds: ["event_1"],
    relationship: { type: "attendee_match", strength: "strong" },
    ...overrides,
  };
}

describe("buildPrioritizationInput", () => {
  it("maps a fully populated situation into bounded input fields", () => {
    const input = buildPrioritizationInput(
      [makeSituation()],
      {
        emailsById: new Map([
          [
            "email_1",
            {
              id: "email_1",
              fromEmail: "john@acme.com",
              subject: "Acme proposal feedback",
              snippet: "Some notes.",
              receivedAt: NOW,
            },
          ],
        ]),
        eventsById: new Map([
          [
            "event_1",
            {
              id: "event_1",
              title: "Acme proposal review",
              startAt: new Date("2026-09-15T10:00:00.000Z"),
              endAt: new Date("2026-09-15T11:00:00.000Z"),
              attendeeEmails: ["john@acme.com"],
            },
          ],
        ]),
        signalsById: new Map([
          ["email_signal", { id: "email_signal", sourceType: "email", confidence: "medium", dueAt: null }],
          [
            "calendar_signal",
            {
              id: "calendar_signal",
              sourceType: "calendar_event",
              confidence: "high",
              dueAt: new Date("2026-09-15T10:00:00.000Z"),
            },
          ],
        ]),
      },
      NOW,
    );

    expect(input.generatedAt).toBe(NOW.toISOString());
    expect(input.situations).toHaveLength(1);
    const situation = input.situations[0]!;
    expect(situation.situationId).toBe("email_signal:calendar_signal");
    expect(situation.relationship).toEqual({ type: "attendee_match", strength: "strong" });
    expect(situation.email).toEqual({
      fromEmail: "john@acme.com",
      subject: "Acme proposal feedback",
      snippet: "Some notes.",
      receivedAt: NOW.toISOString(),
    });
    expect(situation.calendarEvent).toEqual({
      summary: "Acme proposal review",
      startAt: "2026-09-15T10:00:00.000Z",
      endAt: "2026-09-15T11:00:00.000Z",
      attendeeEmails: ["john@acme.com"],
    });
    expect(situation.signals).toEqual([
      { id: "email_signal", sourceType: "email", confidence: "medium", dueAt: null },
      {
        id: "calendar_signal",
        sourceType: "calendar_event",
        confidence: "high",
        dueAt: "2026-09-15T10:00:00.000Z",
      },
    ]);
  });

  it("never includes an email body or calendar description field", () => {
    const input = buildPrioritizationInput(
      [makeSituation()],
      {
        emailsById: new Map([
          [
            "email_1",
            {
              id: "email_1",
              fromEmail: "john@acme.com",
              subject: "x",
              snippet: "y",
              receivedAt: NOW,
            },
          ],
        ]),
        eventsById: new Map([
          [
            "event_1",
            {
              id: "event_1",
              title: "z",
              startAt: NOW,
              endAt: NOW,
              attendeeEmails: [],
            },
          ],
        ]),
        signalsById: new Map(),
      },
      NOW,
    );

    const situation = input.situations[0]!;
    expect(situation.email).not.toHaveProperty("bodyText");
    expect(situation.calendarEvent).not.toHaveProperty("description");
  });

  it("handles a missing email record without throwing", () => {
    const input = buildPrioritizationInput(
      [makeSituation()],
      { emailsById: new Map(), eventsById: new Map(), signalsById: new Map() },
      NOW,
    );
    expect(input.situations[0]?.email).toBeNull();
    expect(input.situations[0]?.calendarEvent).toBeNull();
    expect(input.situations[0]?.signals).toEqual([]);
  });

  it("handles multiple situations independently", () => {
    const input = buildPrioritizationInput(
      [
        makeSituation({ id: "s1", emailIds: ["e1"], calendarEventIds: ["c1"] }),
        makeSituation({ id: "s2", emailIds: ["e2"], calendarEventIds: ["c2"] }),
      ],
      { emailsById: new Map(), eventsById: new Map(), signalsById: new Map() },
      NOW,
    );
    expect(input.situations).toHaveLength(2);
    expect(input.situations.map((s) => s.situationId)).toEqual(["s1", "s2"]);
  });

  it("returns an empty situations array for an empty input", () => {
    const input = buildPrioritizationInput(
      [],
      { emailsById: new Map(), eventsById: new Map(), signalsById: new Map() },
      NOW,
    );
    expect(input.situations).toEqual([]);
  });

  it("is deterministic for identical input", () => {
    const data = {
      emailsById: new Map(),
      eventsById: new Map(),
      signalsById: new Map(),
    };
    expect(buildPrioritizationInput([makeSituation()], data, NOW)).toEqual(
      buildPrioritizationInput([makeSituation()], data, NOW),
    );
  });
});

describe("buildDailyContextPrioritizationInput", () => {
  function makeDailyContext(
    overrides: Partial<DailyAssistantContext> = {},
  ): DailyAssistantContext {
    return {
      currentTime: NOW.toISOString(),
      upcomingEvents: [
        {
          id: "c1",
          summary: "Standup",
          startAt: "2026-09-14T13:00:00.000Z",
          endAt: "2026-09-14T13:30:00.000Z",
          attendeeEmails: [],
        },
      ],
      relevantEmails: [
        {
          id: "e1",
          fromEmail: "jane@acme.com",
          subject: "Quick question",
          snippet: "notes",
          receivedAt: NOW.toISOString(),
        },
      ],
      activeSignals: [],
      consolidatedSituations: [makeSituation()],
      goals: [],
      ...overrides,
    };
  }

  const emptySourceData = { emailsById: new Map(), eventsById: new Map(), signalsById: new Map() };

  it("includes the per-situation detail from buildPrioritizationInput unchanged", () => {
    const input = buildDailyContextPrioritizationInput(
      makeDailyContext(),
      emptySourceData,
      NOW,
    );
    expect(input.situations).toHaveLength(1);
    expect(input.situations[0]?.situationId).toBe("email_signal:calendar_signal");
  });

  it("adds currentTime, upcomingEvents, and relevantEmails from the daily context", () => {
    const input = buildDailyContextPrioritizationInput(
      makeDailyContext(),
      emptySourceData,
      NOW,
    );
    expect(input.currentTime).toBe(NOW.toISOString());
    expect(input.upcomingEvents).toEqual([
      {
        id: "c1",
        summary: "Standup",
        startAt: "2026-09-14T13:00:00.000Z",
        endAt: "2026-09-14T13:30:00.000Z",
        attendeeEmails: [],
      },
    ]);
    expect(input.relevantEmails).toEqual([
      {
        id: "e1",
        fromEmail: "jane@acme.com",
        subject: "Quick question",
        snippet: "notes",
        receivedAt: NOW.toISOString(),
      },
    ]);
  });

  it("omits goals entirely when none are supplied", () => {
    const input = buildDailyContextPrioritizationInput(
      makeDailyContext(),
      emptySourceData,
      NOW,
    );
    expect(input.goals).toBeUndefined();
  });

  it("includes goals when supplied", () => {
    const input = buildDailyContextPrioritizationInput(
      makeDailyContext(),
      emptySourceData,
      NOW,
      [{ id: "g1", title: "Launch my product", description: null }],
    );
    expect(input.goals).toEqual([{ id: "g1", title: "Launch my product", description: null }]);
  });

  it("is deterministic for identical input", () => {
    const context = makeDailyContext();
    expect(buildDailyContextPrioritizationInput(context, emptySourceData, NOW)).toEqual(
      buildDailyContextPrioritizationInput(context, emptySourceData, NOW),
    );
  });
});
