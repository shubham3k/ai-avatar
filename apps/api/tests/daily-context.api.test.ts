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

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
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
    snippet: "Some notes.",
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
    description: "Sensitive internal notes about the deal",
    startAt: hoursFromNow(1),
    endAt: hoursFromNow(2),
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
  sourceType?: string;
  sourceId?: string;
  status?: string;
  dueAt?: Date;
  importanceHints?: Record<string, unknown>;
}

async function createSignal(userId: string, overrides: SignalOverrides = {}) {
  const merged = {
    sourceType: "email",
    sourceId: `src-${Math.random().toString(36).slice(2)}`,
    status: "open",
    dueAt: undefined as Date | undefined,
    importanceHints: { confidence: "high" } as Record<string, unknown>,
    ...overrides,
  };
  return prisma.signal.create({
    data: {
      userId,
      type: "user_action_required",
      title: "John needs a response",
      summary: "John appears to need a response.",
      ...merged,
      importanceHints: JSON.stringify(merged.importanceHints),
    },
  });
}

describe("daily context API", () => {
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

  it("returns a fully empty, bounded context when there is no data", async () => {
    await ensureDemoUser();

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.upcomingEvents).toEqual([]);
    expect(body.relevantEmails).toEqual([]);
    expect(body.activeSignals).toEqual([]);
    expect(body.consolidatedSituations).toEqual([]);
    expect(typeof body.currentTime).toBe("string");
  });

  it("includes an email received within the last 24 hours", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, { receivedAt: hoursFromNow(-1) });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    const body = res.json();
    expect(body.relevantEmails).toHaveLength(1);
    expect(body.relevantEmails[0].id).toBe(email.id);
  });

  it("excludes an email received more than 24 hours ago", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId, { receivedAt: hoursFromNow(-30) });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    expect(res.json().relevantEmails).toEqual([]);
  });

  it("includes a calendar event starting within the next 24 hours", async () => {
    const userId = await ensureDemoUser();
    const event = await createCalendarEvent(userId, {
      startAt: hoursFromNow(3),
      endAt: hoursFromNow(4),
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    const body = res.json();
    expect(body.upcomingEvents).toHaveLength(1);
    expect(body.upcomingEvents[0].id).toBe(event.id);
  });

  it("excludes a calendar event starting more than 24 hours from now", async () => {
    const userId = await ensureDemoUser();
    await createCalendarEvent(userId, {
      startAt: hoursFromNow(48),
      endAt: hoursFromNow(49),
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    expect(res.json().upcomingEvents).toEqual([]);
  });

  it("includes an open (active) signal", async () => {
    const userId = await ensureDemoUser();
    const signal = await createSignal(userId);

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    const body = res.json();
    expect(body.activeSignals).toHaveLength(1);
    expect(body.activeSignals[0]).toMatchObject({ id: signal.id, confidence: "high" });
  });

  it("excludes a resolved signal", async () => {
    const userId = await ensureDemoUser();
    await createSignal(userId, { status: "resolved" });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    expect(res.json().activeSignals).toEqual([]);
  });

  it("includes a consolidated situation when email and calendar signals correlate", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, {
      fromEmail: "john@acme.com",
      receivedAt: hoursFromNow(-1),
    });
    const event = await createCalendarEvent(userId, {
      attendeeEmails: ["john@acme.com"],
      startAt: hoursFromNow(3),
    });
    await createSignal(userId, { sourceType: "email", sourceId: email.id });
    await createSignal(userId, {
      sourceType: "calendar_event",
      sourceId: event.id,
      dueAt: event.startAt,
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    const body = res.json();
    expect(body.consolidatedSituations).toHaveLength(1);
    expect(body.consolidatedSituations[0].relationship).toMatchObject({
      type: "attendee_match",
      strength: "strong",
    });
  });

  it("does not expose email body, calendar description, or credentials", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId, { snippet: "top secret snippet content" });
    await createCalendarEvent(userId, {
      description: "Sensitive internal notes about the deal",
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    expect(res.body).not.toMatch(/Sensitive internal notes/i);
    expect(res.body).not.toMatch(/refreshToken|accessToken|Encrypted/i);
  });

  it("does not create any Signal or Intervention rows (read-only)", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId);
    await createCalendarEvent(userId);
    const signalCountBefore = await prisma.signal.count();

    await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    expect(await prisma.signal.count()).toBe(signalCountBefore);
    expect(await prisma.intervention.count()).toBe(0);
  });

  it("includes active goals (Phase 3.4) and excludes inactive ones", async () => {
    const userId = await ensureDemoUser();
    const active = await prisma.goal.create({
      data: { userId, title: "Launch my product", description: "v1 by Q4" },
    });
    await prisma.goal.create({ data: { userId, title: "Old goal", active: false } });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/daily" });

    const body = res.json();
    expect(body.goals).toHaveLength(1);
    expect(body.goals[0]).toEqual({
      id: active.id,
      title: "Launch my product",
      description: "v1 by Q4",
    });
  });

  it("does not mix data across different users", async () => {
    const userId = await ensureDemoUser();
    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });
    await createEmail(otherUser.id, { receivedAt: hoursFromNow(-1) });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/context/daily",
      headers: { "x-user-id": userId },
    });

    expect(res.json().relevantEmails).toEqual([]);
  });
});
