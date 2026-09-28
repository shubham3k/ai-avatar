import { describe, expect, it } from "vitest";
import { detectUpcomingMeeting } from "./upcoming-meeting.detector.js";
import type { UpcomingMeetingInput } from "./upcoming-meeting.types.js";

const NOW = new Date("2026-09-14T16:00:00.000Z"); // 4:00 PM UTC reference

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

function makeInput(overrides: Partial<UpcomingMeetingInput> = {}): UpcomingMeetingInput {
  return {
    title: "Client meeting",
    startAt: minutesFromNow(20),
    endAt: minutesFromNow(50),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: "organizer@example.com",
    organizerName: "Org",
    attendees: [],
    ...overrides,
  };
}

describe("detectUpcomingMeeting — positive cases", () => {
  it("does not flag a meeting 25 minutes out — the window is 10 minutes (ADR-005)", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(25) }), NOW);
    expect(result.actionable).toBe(false);
  });

  it("still supports a medium tier when called with a wider custom window", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(25) }), NOW, 30, 10);
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("medium");
  });

  it("flags a meeting starting within the 10-minute window as high priority", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(8) }), NOW);
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("flags a meeting starting in 5 minutes as high priority", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(5) }), NOW);
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("produces a useful, non-generic summary message", () => {
    const result = detectUpcomingMeeting(
      makeInput({ title: "Client meeting", startAt: minutesFromNow(8) }),
      NOW,
    );
    expect(result.reason).toBe("Client meeting starts in 8 minutes.");
    expect(result.reason).not.toMatch(/you have a calendar event/i);
  });

  it("matches the documented example: meeting with Acme in 10 minutes", () => {
    const result = detectUpcomingMeeting(
      makeInput({ title: "Meeting with Acme", startAt: minutesFromNow(10) }),
      NOW,
    );
    expect(result.reason).toBe("Meeting with Acme starts in 10 minutes.");
    expect(result.confidence).toBe("high");
  });

  it("uses a safe fallback title when summary is missing", () => {
    const result = detectUpcomingMeeting(
      makeInput({ title: null, startAt: minutesFromNow(7) }),
      NOW,
    );
    expect(result.reason).toBe("Upcoming meeting starts in 7 minutes.");
  });

  it("uses the fallback title when summary is an empty/whitespace string", () => {
    const result = detectUpcomingMeeting(makeInput({ title: "   ", startAt: minutesFromNow(10) }), NOW);
    expect(result.reason).toBe("Upcoming meeting starts in 10 minutes.");
  });
});

describe("detectUpcomingMeeting — negative cases", () => {
  it("does not flag a meeting far in the future (2 hours)", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(120) }), NOW);
    expect(result.actionable).toBe(false);
  });

  it("does not flag a meeting that already started", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(-5) }), NOW);
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/already started/i);
  });

  it("does not flag a meeting that already ended", () => {
    const result = detectUpcomingMeeting(
      makeInput({ startAt: minutesFromNow(-60), endAt: minutesFromNow(-30) }),
      NOW,
    );
    expect(result.actionable).toBe(false);
  });

  it("does not flag a cancelled event", () => {
    const result = detectUpcomingMeeting(
      makeInput({ status: "cancelled", startAt: minutesFromNow(5) }),
      NOW,
    );
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it("does not flag an event with a missing start time", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: null }), NOW);
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/no valid start time/i);
  });

  it("does not flag an event with an invalid start time", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: new Date("not-a-date") }), NOW);
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/no valid start time/i);
  });

  it("does not flag an all-day event", () => {
    const result = detectUpcomingMeeting(
      makeInput({ isAllDay: true, startAt: minutesFromNow(5) }),
      NOW,
    );
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/all-day/i);
  });
});

describe("detectUpcomingMeeting — boundary cases", () => {
  it("is actionable and high priority at exactly 10 minutes (inclusive) — a 4pm meeting alerts at 3:50", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(10) }), NOW);
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("is not actionable at 11 minutes (just outside the window)", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(11) }), NOW);
    expect(result.actionable).toBe(false);
  });

  it("is actionable at exactly 0 minutes (starting now)", () => {
    const result = detectUpcomingMeeting(makeInput({ startAt: minutesFromNow(0) }), NOW);
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
  });
});

describe("detectUpcomingMeeting — attendee context", () => {
  it("does not become actionable merely because attendees exist", () => {
    const withAttendees = detectUpcomingMeeting(
      makeInput({
        startAt: minutesFromNow(120),
        attendees: [
          { email: "a@example.com", displayName: "A", responseStatus: "accepted" },
          { email: "b@example.com", displayName: "B", responseStatus: "accepted" },
        ],
      }),
      NOW,
    );
    expect(withAttendees.actionable).toBe(false);
  });

  it("is actionable within the window regardless of attendee presence", () => {
    const noAttendees = detectUpcomingMeeting(
      makeInput({ startAt: minutesFromNow(5), attendees: [] }),
      NOW,
    );
    const manyAttendees = detectUpcomingMeeting(
      makeInput({
        startAt: minutesFromNow(5),
        attendees: [
          { email: "a@example.com", displayName: "A", responseStatus: "accepted" },
          { email: "b@example.com", displayName: "B", responseStatus: "accepted" },
          { email: "c@example.com", displayName: "C", responseStatus: "accepted" },
        ],
      }),
      NOW,
    );
    expect(noAttendees.actionable).toBe(true);
    expect(manyAttendees.actionable).toBe(true);
    expect(noAttendees.confidence).toBe(manyAttendees.confidence);
  });

  it("handles missing attendees array without throwing", () => {
    const result = detectUpcomingMeeting(
      { ...makeInput({ startAt: minutesFromNow(5) }), attendees: [] },
      NOW,
    );
    expect(result.actionable).toBe(true);
  });
});

describe("detectUpcomingMeeting — edge cases", () => {
  it("handles an unusual summary (emoji, long text) without throwing", () => {
    const result = detectUpcomingMeeting(
      makeInput({
        title: "🚀 Launch sync!!! (URGENT) — please read before joining",
        startAt: minutesFromNow(5),
      }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.reason).toContain("🚀 Launch sync!!! (URGENT) — please read before joining");
  });

  it("is deterministic: identical input always produces identical output", () => {
    const input = makeInput({ startAt: minutesFromNow(8) });
    const first = detectUpcomingMeeting(input, NOW);
    const second = detectUpcomingMeeting(input, NOW);
    expect(first).toEqual(second);
  });

  it("never throws on a fully malformed input", () => {
    expect(() =>
      detectUpcomingMeeting(
        {
          title: null,
          startAt: null,
          endAt: null,
          isAllDay: false,
          status: null,
          organizerEmail: null,
          organizerName: null,
          attendees: [],
        },
        NOW,
      ),
    ).not.toThrow();
  });
});
