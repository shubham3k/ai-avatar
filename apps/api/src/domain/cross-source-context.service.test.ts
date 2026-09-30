import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../db/repositories/calendar-events.repository.js";
import type { Email } from "../db/repositories/emails.repository.js";
import { createCrossSourceContextService } from "./cross-source-context.service.js";
import {
  CALENDAR_WINDOW_DAYS,
  CONTEXT_FETCH_LIMIT,
  EMAIL_WINDOW_DAYS,
} from "./context/cross-source-context.rules.js";
import type { EmailsRepository } from "../db/repositories/emails.repository.js";
import type { CalendarEventsRepository } from "../db/repositories/calendar-events.repository.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "email_1",
    userId: "user_1",
    providerMessageId: "msg_1",
    threadId: "thread_1",
    fromEmail: "john@acme.com",
    fromName: "John",
    toEmails: [],
    subject: "Acme proposal feedback",
    snippet: "",
    bodyText: null,
    receivedAt: NOW,
    isRead: false,
    labels: [],
    sourceUrl: null,
    rawUpdatedAt: null,
    sentAnalyzedAt: null,
    expectsReply: null,
    followUpCheckedAt: null,
    repliedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event_1",
    userId: "user_1",
    providerEventId: "evt_1",
    calendarId: "primary",
    title: "Acme proposal review",
    description: null,
    location: null,
    startAt: new Date(NOW.getTime() + DAY_MS),
    endAt: new Date(NOW.getTime() + DAY_MS + 3600_000),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: null,
    organizerName: null,
    attendeeEmails: ["john@acme.com"],
    attendees: [],
    sourceUrl: null,
    rawUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEmails(overrides: Partial<EmailsRepository> = {}): EmailsRepository {
  return {
    upsertEmail: vi.fn(),
    upsertMany: vi.fn(),
    findByProviderMessageId: vi.fn(),
    listRecent: vi.fn().mockResolvedValue([makeEmail()]),
    ...overrides,
  };
}

function makeEvents(overrides: Partial<CalendarEventsRepository> = {}): CalendarEventsRepository {
  return {
    upsertEvent: vi.fn(),
    upsertMany: vi.fn(),
    findByProviderEventId: vi.fn(),
    listUpcoming: vi.fn().mockResolvedValue([makeEvent()]),
    ...overrides,
  };
}

describe("cross-source context service", () => {
  it("loads bounded recent emails and upcoming events, then builds context", async () => {
    const emails = makeEmails();
    const events = makeEvents();
    const service = createCrossSourceContextService({ emails, events });

    const contexts = await service.getContext("user_1", NOW);

    expect(emails.listRecent).toHaveBeenCalledWith("user_1", CONTEXT_FETCH_LIMIT);
    expect(events.listUpcoming).toHaveBeenCalledWith("user_1", CONTEXT_FETCH_LIMIT, NOW);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.relationship.type).toBe("attendee_match");
  });

  it("filters out emails older than the 14-day window", async () => {
    const oldEmail = makeEmail({
      id: "old",
      receivedAt: new Date(NOW.getTime() - (EMAIL_WINDOW_DAYS + 1) * DAY_MS),
    });
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([oldEmail]) });
    const events = makeEvents();
    const service = createCrossSourceContextService({ emails, events });

    const contexts = await service.getContext("user_1", NOW);

    expect(contexts).toHaveLength(0);
  });

  it("includes an email exactly at the edge of the 14-day window", async () => {
    const edgeEmail = makeEmail({
      id: "edge",
      receivedAt: new Date(NOW.getTime() - EMAIL_WINDOW_DAYS * DAY_MS),
    });
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([edgeEmail]) });
    const service = createCrossSourceContextService({ emails, events: makeEvents() });

    const contexts = await service.getContext("user_1", NOW);

    expect(contexts).toHaveLength(1);
  });

  it("filters out events further out than the 7-day window", async () => {
    const farEvent = makeEvent({
      id: "far",
      startAt: new Date(NOW.getTime() + (CALENDAR_WINDOW_DAYS + 1) * DAY_MS),
    });
    const events = makeEvents({ listUpcoming: vi.fn().mockResolvedValue([farEvent]) });
    const service = createCrossSourceContextService({ emails: makeEmails(), events });

    const contexts = await service.getContext("user_1", NOW);

    expect(contexts).toHaveLength(0);
  });

  it("returns an empty array when there are no emails", async () => {
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([]) });
    const service = createCrossSourceContextService({ emails, events: makeEvents() });

    const contexts = await service.getContext("user_1", NOW);

    expect(contexts).toEqual([]);
  });

  it("returns an empty array when there are no calendar events", async () => {
    const events = makeEvents({ listUpcoming: vi.fn().mockResolvedValue([]) });
    const service = createCrossSourceContextService({ emails: makeEmails(), events });

    const contexts = await service.getContext("user_1", NOW);

    expect(contexts).toEqual([]);
  });

  it("returns an empty array when both datasets are empty", async () => {
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([]) });
    const events = makeEvents({ listUpcoming: vi.fn().mockResolvedValue([]) });
    const service = createCrossSourceContextService({ emails, events });

    const contexts = await service.getContext("user_1", NOW);

    expect(contexts).toEqual([]);
  });

  it("maps the CalendarEvent's title field to the builder's summary field", async () => {
    const event = makeEvent({ title: "Acme proposal review", attendeeEmails: [] });
    const email = makeEmail({ subject: "Acme proposal feedback", snippet: "" });
    const events = makeEvents({ listUpcoming: vi.fn().mockResolvedValue([event]) });
    const emails = makeEmails({ listRecent: vi.fn().mockResolvedValue([email]) });
    const service = createCrossSourceContextService({ emails, events });

    const contexts = await service.getContext("user_1", NOW);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.relationship.type).toBe("topic_overlap");
  });
});
