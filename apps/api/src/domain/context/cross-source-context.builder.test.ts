import { describe, expect, it } from "vitest";
import { buildCrossSourceContext } from "./cross-source-context.builder.js";
import type {
  ContextCalendarEventInput,
  ContextEmailInput,
} from "./cross-source-context.types.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeEmail(overrides: Partial<ContextEmailInput> = {}): ContextEmailInput {
  return {
    id: "email_1",
    fromEmail: "john@acme.com",
    subject: "Acme proposal feedback",
    snippet: "Wanted to share some thoughts before we talk.",
    receivedAt: NOW,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ContextCalendarEventInput> = {}): ContextCalendarEventInput {
  return {
    id: "event_1",
    summary: "Acme proposal review",
    startAt: new Date("2026-09-15T12:00:00.000Z"),
    attendeeEmails: [],
    ...overrides,
  };
}

describe("buildCrossSourceContext — sender/attendee matching", () => {
  it("produces a strong relationship when the sender is an attendee", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "john@acme.com", subject: "Unrelated", snippet: "" })],
      [makeEvent({ summary: "Standup", attendeeEmails: ["john@acme.com"] })],
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.relationship.type).toBe("attendee_match");
    expect(contexts[0]?.relationship.strength).toBe("strong");
  });

  it("is case-insensitive when matching sender to attendee email", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "John@Acme.com", subject: "x", snippet: "" })],
      [makeEvent({ summary: "y", attendeeEmails: ["john@acme.com"] })],
    );
    expect(contexts[0]?.relationship.type).toBe("attendee_match");
  });

  it("does not match when the sender is not an attendee", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "someone-else@acme.com", subject: "x", snippet: "" })],
      [makeEvent({ summary: "y", attendeeEmails: ["john@acme.com"] })],
    );
    expect(contexts).toHaveLength(0);
  });
});

describe("buildCrossSourceContext — topic overlap", () => {
  it("produces a possible relationship on meaningful subject/summary token overlap", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: "Acme proposal feedback", snippet: "" })],
      [makeEvent({ summary: "Acme proposal review", attendeeEmails: [] })],
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.relationship.type).toBe("topic_overlap");
    expect(contexts[0]?.relationship.strength).toBe("possible");
    expect(contexts[0]?.relationship.matchedTerms).toContain("acme");
    expect(contexts[0]?.relationship.matchedTerms).toContain("proposal");
  });

  it("is case-insensitive and punctuation-insensitive", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: "ACME Proposal!!", snippet: "" })],
      [makeEvent({ summary: "acme, proposal.", attendeeEmails: [] })],
    );
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.relationship.type).toBe("topic_overlap");
  });

  it("does not double count a duplicated term", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: "proposal proposal proposal", snippet: "" })],
      [makeEvent({ summary: "proposal", attendeeEmails: [] })],
    );
    expect(contexts[0]?.relationship.matchedTerms).toEqual(["proposal"]);
  });

  it("does not match on generic words alone (meeting/project/update)", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: "Project update", snippet: "Quick meeting review" })],
      [makeEvent({ summary: "Weekly project meeting update", attendeeEmails: [] })],
    );
    expect(contexts).toHaveLength(0);
  });

  it("does not match on short/noise tokens alone", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: "Re: fyi ok", snippet: "" })],
      [makeEvent({ summary: "ok re fyi", attendeeEmails: [] })],
    );
    expect(contexts).toHaveLength(0);
  });
});

describe("buildCrossSourceContext — combined evidence", () => {
  it("is strong (not a separate tier) and carries topic terms when both attendee match and topic overlap exist", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "john@acme.com", subject: "Acme proposal feedback", snippet: "" })],
      [
        makeEvent({
          summary: "Acme proposal review",
          attendeeEmails: ["john@acme.com"],
        }),
      ],
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.relationship.type).toBe("attendee_match");
    expect(contexts[0]?.relationship.strength).toBe("strong");
    expect(contexts[0]?.relationship.matchedTerms).toContain("acme");
  });
});

describe("buildCrossSourceContext — temporal proximity", () => {
  it("does not create a relationship from time proximity alone", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: "Lunch plans", snippet: "See you soon", receivedAt: NOW })],
      [
        makeEvent({
          summary: "Dentist appointment",
          startAt: new Date(NOW.getTime() + 60 * 60 * 1000),
          attendeeEmails: [],
        }),
      ],
    );
    expect(contexts).toHaveLength(0);
  });

  it("attaches temporal context only once a relationship already exists", () => {
    const emailReceivedAt = NOW;
    const eventStartAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "john@acme.com", receivedAt: emailReceivedAt })],
      [makeEvent({ startAt: eventStartAt, attendeeEmails: ["john@acme.com"] })],
    );

    expect(contexts[0]?.temporalContext).toEqual({
      emailReceivedAt: emailReceivedAt.toISOString(),
      eventStartAt: eventStartAt.toISOString(),
      hoursBetween: 24,
    });
  });
});

describe("buildCrossSourceContext — unrelated and missing data", () => {
  it("returns no relationship for a clearly unrelated email/event pair", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "spam@random.com", subject: "Buy now", snippet: "Discount inside" })],
      [makeEvent({ summary: "Dentist appointment", attendeeEmails: [] })],
    );
    expect(contexts).toHaveLength(0);
  });

  it("handles a missing sender gracefully", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "", subject: "x", snippet: "" })],
      [makeEvent({ attendeeEmails: ["john@acme.com"] })],
    );
    expect(contexts).toHaveLength(0);
  });

  it("handles missing attendees gracefully", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "john@acme.com" })],
      [makeEvent({ attendeeEmails: [] })],
    );
    expect(contexts.every((c) => c.relationship.type !== "attendee_match")).toBe(true);
  });

  it("handles a missing subject gracefully", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: null, snippet: "Acme proposal notes" })],
      [makeEvent({ summary: "Acme proposal review" })],
    );
    expect(contexts).toHaveLength(1);
  });

  it("handles a missing summary gracefully", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ subject: "Acme proposal feedback" })],
      [makeEvent({ summary: null })],
    );
    expect(contexts).toHaveLength(0);
  });

  it("handles both subject and summary missing without throwing", () => {
    expect(() =>
      buildCrossSourceContext(
        [makeEmail({ subject: null, snippet: null })],
        [makeEvent({ summary: null })],
      ),
    ).not.toThrow();
  });

  it("returns an empty array for empty inputs", () => {
    expect(buildCrossSourceContext([], [])).toEqual([]);
  });
});

describe("buildCrossSourceContext — multiple records", () => {
  it("evaluates every email against every event (bounded cross product)", () => {
    const emails = [
      makeEmail({ id: "e1", fromEmail: "john@acme.com", subject: "x", snippet: "" }),
      makeEmail({ id: "e2", fromEmail: "nobody@nowhere.com", subject: "y", snippet: "" }),
    ];
    const events = [
      makeEvent({ id: "c1", summary: "z", attendeeEmails: ["john@acme.com"] }),
      makeEvent({ id: "c2", summary: "w", attendeeEmails: [] }),
    ];

    const contexts = buildCrossSourceContext(emails, events);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ emailId: "e1", calendarEventId: "c1" });
  });

  it("matches one email against multiple qualifying events", () => {
    const contexts = buildCrossSourceContext(
      [makeEmail({ fromEmail: "john@acme.com" })],
      [
        makeEvent({ id: "c1", attendeeEmails: ["john@acme.com"] }),
        makeEvent({ id: "c2", attendeeEmails: ["john@acme.com"] }),
      ],
    );
    expect(contexts).toHaveLength(2);
  });

  it("is deterministic: identical input always produces identical output", () => {
    const emails = [makeEmail()];
    const events = [makeEvent({ attendeeEmails: ["john@acme.com"] })];
    expect(buildCrossSourceContext(emails, events)).toEqual(
      buildCrossSourceContext(emails, events),
    );
  });
});
