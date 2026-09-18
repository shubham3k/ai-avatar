import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { prisma } from "../src/lib/prisma.js";

async function cleanDb() {
  await prisma.intervention.deleteMany();
  await prisma.signal.deleteMany();
  await prisma.email.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.user.deleteMany();
}

async function ensureDemoUser(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: { email: DEMO_USER_EMAIL, displayName: "Demo User", timezone: "UTC" },
  });
  return user.id;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

interface EmailOverrides {
  fromEmail?: string;
  fromName?: string | null;
  toEmails?: string[];
  subject?: string;
  snippet?: string | null;
  receivedAt?: Date;
  isRead?: boolean;
  labels?: string[];
  sourceUrl?: string | null;
}

async function createEmail(userId: string, overrides: EmailOverrides = {}) {
  const merged = {
    fromEmail: "john@acme.com",
    fromName: "John",
    toEmails: [DEMO_USER_EMAIL],
    subject: "Acme proposal feedback",
    snippet: "Some notes before we talk.",
    receivedAt: new Date(),
    isRead: false,
    labels: [] as string[],
    sourceUrl: "https://mail.google.com/mail/u/0/#all/msg",
    ...overrides,
  };
  return prisma.email.create({
    data: {
      userId,
      providerMessageId: `msg-${Math.random().toString(36).slice(2)}`,
      threadId: "thread-1",
      ...merged,
      toEmails: JSON.stringify(merged.toEmails),
      labels: JSON.stringify(merged.labels),
    },
  });
}

interface CalendarEventOverrides {
  title?: string;
  description?: string | null;
  startAt?: Date;
  endAt?: Date;
  isAllDay?: boolean;
  status?: string | null;
  attendeeEmails?: string[];
  sourceUrl?: string | null;
}

async function createCalendarEvent(userId: string, overrides: CalendarEventOverrides = {}) {
  const merged = {
    title: "Acme proposal review",
    description: "Sensitive internal notes",
    startAt: daysFromNow(1),
    endAt: daysFromNow(1),
    isAllDay: false,
    status: "confirmed",
    attendeeEmails: [] as string[],
    sourceUrl: "https://calendar.google.com/event?eid=evt",
    ...overrides,
  };
  return prisma.calendarEvent.create({
    data: {
      userId,
      providerEventId: `evt-${Math.random().toString(36).slice(2)}`,
      calendarId: "primary",
      ...merged,
      attendeeEmails: JSON.stringify(merged.attendeeEmails),
    },
  });
}

interface SignalOverrides {
  status?: string;
  importanceHints?: Record<string, unknown>;
}

async function createEmailSignal(
  userId: string,
  emailId: string,
  overrides: SignalOverrides = {},
) {
  const merged = {
    status: "open",
    importanceHints: { confidence: "medium" } as Record<string, unknown>,
    ...overrides,
  };
  return prisma.signal.create({
    data: {
      userId,
      type: "user_action_required",
      sourceType: "email",
      sourceId: emailId,
      title: "John needs your response",
      summary: "John appears to need a response.",
      ...merged,
      importanceHints: JSON.stringify(merged.importanceHints),
    },
  });
}

async function createCalendarSignal(
  userId: string,
  eventId: string,
  startAt: Date,
  overrides: SignalOverrides = {},
) {
  const merged = {
    status: "open",
    importanceHints: { confidence: "high" } as Record<string, unknown>,
    ...overrides,
  };
  return prisma.signal.create({
    data: {
      userId,
      type: "user_action_required",
      sourceType: "calendar_event",
      sourceId: eventId,
      title: "Acme proposal review",
      summary: "Acme proposal review starts soon.",
      dueAt: startAt,
      ...merged,
      importanceHints: JSON.stringify(merged.importanceHints),
    },
  });
}

describe("consolidated situations API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await cleanDb();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("returns an empty array when there is no data", async () => {
    await ensureDemoUser();

    const res = await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ situations: [] });
  });

  it("consolidates a related email signal and calendar signal into one situation", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, {
      fromEmail: "john@acme.com",
      subject: "Acme proposal feedback",
    });
    const event = await createCalendarEvent(userId, {
      title: "Acme proposal review",
      attendeeEmails: ["john@acme.com"],
    });
    const emailSignal = await createEmailSignal(userId, email.id);
    const calendarSignal = await createCalendarSignal(userId, event.id, event.startAt);

    const res = await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.situations).toHaveLength(1);
    expect(body.situations[0].signalIds.sort()).toEqual(
      [emailSignal.id, calendarSignal.id].sort(),
    );
    expect(body.situations[0].emailIds).toEqual([email.id]);
    expect(body.situations[0].calendarEventIds).toEqual([event.id]);
    expect(body.situations[0].relationship.type).toBe("attendee_match");
    // Calendar signal has "high" confidence vs the email signal's "medium" → primary.
    expect(body.situations[0].primarySignalId).toBe(calendarSignal.id);
  });

  it("keeps unrelated signals independent (no correlation, no consolidation)", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, {
      fromEmail: "spam@random.com",
      subject: "Invoice",
      snippet: "",
    });
    const event = await createCalendarEvent(userId, {
      title: "Hiring debrief",
      attendeeEmails: [],
    });
    await createEmailSignal(userId, email.id);
    await createCalendarSignal(userId, event.id, event.startAt);

    const res = await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    expect(res.json().situations).toEqual([]);
  });

  it("does not consolidate on a possible relationship's underlying signals differently than documented (still consolidates, conservatively)", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, {
      fromEmail: "unrelated@example.com",
      subject: "Acme proposal feedback",
      snippet: "",
    });
    const event = await createCalendarEvent(userId, {
      title: "Acme proposal review",
      attendeeEmails: [],
    });
    await createEmailSignal(userId, email.id);
    await createCalendarSignal(userId, event.id, event.startAt);

    const res = await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    const body = res.json();
    expect(body.situations).toHaveLength(1);
    expect(body.situations[0].relationship).toEqual({ type: "topic_overlap", strength: "possible" });
  });

  it("does not consolidate signals whose events only share generic words", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, {
      fromEmail: "unrelated@example.com",
      subject: "Project update",
      snippet: "quick meeting review",
    });
    const event = await createCalendarEvent(userId, {
      title: "Weekly project meeting update",
      attendeeEmails: [],
    });
    await createEmailSignal(userId, email.id);
    await createCalendarSignal(userId, event.id, event.startAt);

    const res = await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    expect(res.json().situations).toEqual([]);
  });

  it("does not create any new signals or interventions", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, { fromEmail: "john@acme.com" });
    const event = await createCalendarEvent(userId, { attendeeEmails: ["john@acme.com"] });
    await createEmailSignal(userId, email.id);
    await createCalendarSignal(userId, event.id, event.startAt);

    const signalCountBefore = await prisma.signal.count();
    const interventionCountBefore = await prisma.intervention.count();

    await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    expect(await prisma.signal.count()).toBe(signalCountBefore);
    expect(await prisma.intervention.count()).toBe(interventionCountBefore);
  });

  it("does not expose credentials or unnecessary sensitive content", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, {
      fromEmail: "john@acme.com",
      snippet: "top secret snippet content",
    });
    const event = await createCalendarEvent(userId, {
      description: "Sensitive internal notes about the deal",
      attendeeEmails: ["john@acme.com"],
    });
    await createEmailSignal(userId, email.id);
    await createCalendarSignal(userId, event.id, event.startAt);

    const res = await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    expect(res.body).not.toMatch(/top secret snippet content/i);
    expect(res.body).not.toMatch(/Sensitive internal notes/i);
    expect(res.body).not.toMatch(/refreshToken|accessToken|Encrypted/i);
  });

  it("returns only the documented fields", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, { fromEmail: "john@acme.com" });
    const event = await createCalendarEvent(userId, { attendeeEmails: ["john@acme.com"] });
    await createEmailSignal(userId, email.id);
    await createCalendarSignal(userId, event.id, event.startAt);

    const res = await app.inject({ method: "GET", url: "/api/v1/context/situations" });

    const situation = res.json().situations[0];
    expect(Object.keys(situation).sort()).toEqual(
      [
        "calendarEventIds",
        "emailIds",
        "id",
        "primarySignalId",
        "relationship",
        "signalIds",
      ].sort(),
    );
  });
});
