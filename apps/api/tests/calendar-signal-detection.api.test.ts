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

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

interface CalendarEventOverrides {
  title?: string;
  description?: string | null;
  startAt?: Date;
  endAt?: Date;
  isAllDay?: boolean;
  status?: string | null;
  organizerEmail?: string | null;
  attendeeEmails?: string[];
  sourceUrl?: string | null;
}

async function createCalendarEvent(userId: string, overrides: CalendarEventOverrides = {}) {
  const merged = {
    title: "Client meeting",
    description: "Discuss contract renewal",
    startAt: minutesFromNow(8),
    endAt: minutesFromNow(38),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: "organizer@example.com",
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

describe("calendar signal detection API", () => {
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

  it("returns zero counts when there are no stored events", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/detect-signals",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      analyzed: 0,
      actionable: 0,
      signalsCreated: 0,
      interventionsCreated: 0,
    });
  });

  it("does not create signals for events outside the attention window", async () => {
    const userId = await ensureDemoUser();
    await createCalendarEvent(userId, { startAt: minutesFromNow(120), endAt: minutesFromNow(150) });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/detect-signals",
    });

    expect(res.json()).toEqual({
      analyzed: 1,
      actionable: 0,
      signalsCreated: 0,
      interventionsCreated: 0,
    });
    expect(await prisma.signal.count()).toBe(0);
    expect(await prisma.intervention.count()).toBe(0);
  });

  it("creates a signal and intervention for an actionable (soon-starting) event", async () => {
    const userId = await ensureDemoUser();
    const event = await createCalendarEvent(userId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/detect-signals",
    });

    expect(res.json()).toEqual({
      analyzed: 1,
      actionable: 1,
      signalsCreated: 1,
      interventionsCreated: 1,
    });

    const signal = await prisma.signal.findFirst({ where: { userId } });
    expect(signal?.type).toBe("user_action_required");
    expect(signal?.sourceType).toBe("calendar_event");
    expect(signal?.sourceId).toBe(event.id);

    const intervention = await prisma.intervention.findUnique({
      where: { signalId: signal!.id },
    });
    expect(intervention?.status).toBe("pending");
    expect(intervention?.priority).toBe("high");
    expect(intervention?.message).toMatch(/Client meeting starts in \d+ minutes?\./);
    expect(intervention?.message).not.toMatch(/you have a calendar event/i);
  });

  it("is idempotent: running detection twice does not duplicate signals or interventions", async () => {
    const userId = await ensureDemoUser();
    await createCalendarEvent(userId);

    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/detect-signals" });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/detect-signals",
    });

    expect(second.json()).toEqual({
      analyzed: 1,
      actionable: 1,
      signalsCreated: 0,
      interventionsCreated: 0,
    });
    expect(await prisma.signal.count({ where: { userId } })).toBe(1);
    expect(await prisma.intervention.count({ where: { userId } })).toBe(1);
  });

  it("rejects a limit above the safe maximum", async () => {
    const userId = await ensureDemoUser();
    await createCalendarEvent(userId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/detect-signals?limit=9999",
    });

    expect(res.statusCode).toBe(400);
  });

  it("does not sync Calendar as a side effect of detecting signals", async () => {
    const userId = await ensureDemoUser();
    await createCalendarEvent(userId);
    const before = await prisma.calendarEvent.count({ where: { userId } });

    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/detect-signals" });

    const after = await prisma.calendarEvent.count({ where: { userId } });
    expect(after).toBe(before);
  });

  it("the generated intervention flows through the existing inbox/Done/Snooze lifecycle", async () => {
    const userId = await ensureDemoUser();
    await createCalendarEvent(userId);

    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/detect-signals" });

    const inbox = await app.inject({ method: "GET", url: "/api/v1/interventions" });
    expect(inbox.json().items).toHaveLength(1);
    const interventionId = inbox.json().items[0].id;

    const snoozeRes = await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${interventionId}/snooze`,
      payload: { minutes: 30 },
    });
    expect(snoozeRes.statusCode).toBe(200);
    expect(snoozeRes.json().status).toBe("snoozed");

    const doneRes = await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${interventionId}/done`,
      payload: {},
    });
    expect(doneRes.statusCode).toBe(200);
    expect(doneRes.json().status).toBe("resolved");
  });

  it("never returns event content, only the summary", async () => {
    const userId = await ensureDemoUser();
    await createCalendarEvent(userId, { description: "Sensitive contract terms" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/detect-signals",
    });

    expect(Object.keys(res.json()).sort()).toEqual([
      "actionable",
      "analyzed",
      "interventionsCreated",
      "signalsCreated",
    ]);
    expect(res.body).not.toMatch(/Sensitive contract terms/i);
  });
});
