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
    description: "Sensitive internal notes about the deal",
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

describe("cross-source context API", () => {
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

    const res = await app.inject({ method: "GET", url: "/api/v1/context/cross-source" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ contexts: [] });
  });

  it("returns an empty array when nothing correlates", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId, {
      fromEmail: "spam@random.com",
      subject: "Buy now",
      snippet: "Discount inside",
    });
    await createCalendarEvent(userId, {
      title: "Dentist appointment",
      attendeeEmails: [],
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/cross-source" });

    expect(res.json()).toEqual({ contexts: [] });
  });

  it("returns a strong attendee_match relationship", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId, {
      fromEmail: "john@acme.com",
      subject: "Unrelated subject",
      snippet: "",
    });
    const event = await createCalendarEvent(userId, {
      title: "Standup",
      attendeeEmails: ["john@acme.com"],
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/cross-source" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contexts).toHaveLength(1);
    expect(body.contexts[0]).toMatchObject({
      emailId: email.id,
      calendarEventId: event.id,
      relationship: { type: "attendee_match", strength: "strong" },
    });
  });

  it("returns a possible topic_overlap relationship", async () => {
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

    const res = await app.inject({ method: "GET", url: "/api/v1/context/cross-source" });

    const body = res.json();
    expect(body.contexts).toHaveLength(1);
    expect(body.contexts[0]).toMatchObject({
      emailId: email.id,
      calendarEventId: event.id,
      relationship: { type: "topic_overlap", strength: "possible" },
    });
  });

  it("does not expose email body, calendar description, or credentials", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId, {
      fromEmail: "john@acme.com",
      subject: "Acme proposal feedback",
      snippet: "top secret snippet content",
    });
    await createCalendarEvent(userId, {
      title: "Acme proposal review",
      description: "Sensitive internal notes about the deal",
      attendeeEmails: ["john@acme.com"],
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/context/cross-source" });

    expect(res.body).not.toMatch(/top secret snippet content/i);
    expect(res.body).not.toMatch(/Sensitive internal notes/i);
    expect(res.body).not.toMatch(/refreshToken|accessToken|Encrypted/i);
  });

  it("does not create any signals or interventions", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId, { fromEmail: "john@acme.com" });
    await createCalendarEvent(userId, { attendeeEmails: ["john@acme.com"] });

    await app.inject({ method: "GET", url: "/api/v1/context/cross-source" });

    expect(await prisma.signal.count()).toBe(0);
    expect(await prisma.intervention.count()).toBe(0);
  });

  it("does not correlate data across different users", async () => {
    const userId = await ensureDemoUser();
    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });
    await createEmail(otherUser.id, { fromEmail: "john@acme.com" });
    await createCalendarEvent(userId, { attendeeEmails: ["john@acme.com"] });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/context/cross-source",
      headers: { "x-user-id": userId },
    });

    expect(res.json().contexts).toEqual([]);
  });
});
