import { describe, expect, it } from "vitest";
import { buildDailyContext } from "./daily-context.builder.js";
import type { DailyContextSourceData } from "./daily-context.types.js";
import type { ConsolidatedSituation } from "../context/consolidated-situation.types.js";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function emptyData(overrides: Partial<DailyContextSourceData> = {}): DailyContextSourceData {
  return {
    recentEmails: [],
    upcomingEvents: [],
    openSignals: [],
    situations: [],
    goals: [],
    ...overrides,
  };
}

const SITUATION: ConsolidatedSituation = {
  id: "s1",
  signalIds: ["sig1"],
  primarySignalId: "sig1",
  emailIds: ["e1"],
  calendarEventIds: [],
  relationship: { type: "topic_overlap", strength: "possible" },
};

describe("buildDailyContext", () => {
  it("sets currentTime to the supplied now", () => {
    const context = buildDailyContext(emptyData(), NOW);
    expect(context.currentTime).toBe(NOW.toISOString());
  });

  it("includes an email received within the last 24 hours", () => {
    const context = buildDailyContext(
      emptyData({
        recentEmails: [
          {
            id: "e1",
            fromEmail: "john@acme.com",
            subject: "Feedback needed",
            snippet: "Please review",
            receivedAt: new Date("2026-09-16T00:00:00.000Z"), // 12h before NOW
          },
        ],
      }),
      NOW,
    );
    expect(context.relevantEmails).toHaveLength(1);
    expect(context.relevantEmails[0]).toEqual({
      id: "e1",
      fromEmail: "john@acme.com",
      subject: "Feedback needed",
      snippet: "Please review",
      receivedAt: "2026-09-16T00:00:00.000Z",
    });
  });

  it("excludes an email received more than 24 hours ago", () => {
    const context = buildDailyContext(
      emptyData({
        recentEmails: [
          {
            id: "e_old",
            fromEmail: "john@acme.com",
            subject: "Old",
            snippet: null,
            receivedAt: new Date("2026-09-14T00:00:00.000Z"), // 60h before NOW
          },
        ],
      }),
      NOW,
    );
    expect(context.relevantEmails).toEqual([]);
  });

  it("includes a calendar event starting within the next 24 hours", () => {
    const context = buildDailyContext(
      emptyData({
        upcomingEvents: [
          {
            id: "c1",
            title: "Acme review",
            startAt: new Date("2026-09-17T00:00:00.000Z"), // 12h after NOW
            endAt: new Date("2026-09-17T01:00:00.000Z"),
            attendeeEmails: ["john@acme.com"],
          },
        ],
      }),
      NOW,
    );
    expect(context.upcomingEvents).toHaveLength(1);
    expect(context.upcomingEvents[0]).toEqual({
      id: "c1",
      summary: "Acme review",
      startAt: "2026-09-17T00:00:00.000Z",
      endAt: "2026-09-17T01:00:00.000Z",
      attendeeEmails: ["john@acme.com"],
    });
  });

  it("excludes a calendar event starting more than 24 hours from now", () => {
    const context = buildDailyContext(
      emptyData({
        upcomingEvents: [
          {
            id: "c_far",
            title: "Far off",
            startAt: new Date("2026-09-20T00:00:00.000Z"), // days after NOW
            endAt: new Date("2026-09-20T01:00:00.000Z"),
            attendeeEmails: [],
          },
        ],
      }),
      NOW,
    );
    expect(context.upcomingEvents).toEqual([]);
  });

  it("maps active signals including confidence from importanceHints", () => {
    const context = buildDailyContext(
      emptyData({
        openSignals: [
          {
            id: "sig1",
            sourceType: "email",
            title: "John needs a response",
            dueAt: new Date("2026-09-16T18:00:00.000Z"),
            importanceHints: { confidence: "high" },
          },
        ],
      }),
      NOW,
    );
    expect(context.activeSignals).toEqual([
      {
        id: "sig1",
        sourceType: "email",
        title: "John needs a response",
        confidence: "high",
        dueAt: "2026-09-16T18:00:00.000Z",
      },
    ]);
  });

  it("defaults confidence to null when importanceHints has no usable confidence", () => {
    const context = buildDailyContext(
      emptyData({
        openSignals: [
          {
            id: "sig2",
            sourceType: "calendar_event",
            title: "Meeting soon",
            dueAt: null,
            importanceHints: null,
          },
        ],
      }),
      NOW,
    );
    expect(context.activeSignals[0]?.confidence).toBeNull();
  });

  it("passes consolidated situations through unchanged", () => {
    const context = buildDailyContext(emptyData({ situations: [SITUATION] }), NOW);
    expect(context.consolidatedSituations).toEqual([SITUATION]);
  });

  it("never includes an email body or calendar description field", () => {
    const context = buildDailyContext(
      emptyData({
        recentEmails: [
          {
            id: "e1",
            fromEmail: "a@b.com",
            subject: "s",
            snippet: "snip",
            receivedAt: NOW,
          },
        ],
        upcomingEvents: [
          {
            id: "c1",
            title: "t",
            startAt: NOW,
            endAt: NOW,
            attendeeEmails: [],
          },
        ],
      }),
      NOW,
    );
    expect(context.relevantEmails[0]).not.toHaveProperty("bodyText");
    expect(context.upcomingEvents[0]).not.toHaveProperty("description");
  });

  it("is deterministic for identical input", () => {
    const data = emptyData({ situations: [SITUATION] });
    expect(buildDailyContext(data, NOW)).toEqual(buildDailyContext(data, NOW));
  });

  it("returns empty arrays for a user with no data at all", () => {
    const context = buildDailyContext(emptyData(), NOW);
    expect(context).toEqual({
      currentTime: NOW.toISOString(),
      upcomingEvents: [],
      relevantEmails: [],
      activeSignals: [],
      consolidatedSituations: [],
      goals: [],
    });
  });

  it("maps active goals to their bounded id/title/description shape", () => {
    const context = buildDailyContext(
      emptyData({
        goals: [{ id: "g1", title: "Launch my product", description: "v1 by Q4" }],
      }),
      NOW,
    );
    expect(context.goals).toEqual([
      { id: "g1", title: "Launch my product", description: "v1 by Q4" },
    ]);
  });
});
