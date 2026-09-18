import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { prisma } from "../src/lib/prisma.js";

const listUpcomingEvents = vi.fn();

vi.mock("../src/providers/google/calendar/calendar.service.js", () => ({
  createCalendarService: () => ({ listUpcomingEvents }),
}));

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

async function connectGoogle(userId: string) {
  await prisma.integration.create({
    data: {
      userId,
      provider: "google",
      status: "connected",
      providerAccountId: "google-account-1",
      providerAccountEmail: "demo@example.local",
      refreshTokenEncrypted: encryptSecret("super-secret-refresh-token"),
      scopes: JSON.stringify(["calendar.readonly"]),
    },
  });
}

// Far in the future so listUpcoming's `startAt >= now` filter never excludes it.
function calendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    calendarId: "primary",
    summary: "Launch review",
    description: "Discuss launch readiness",
    location: "Conference Room A",
    start: "2030-01-15T10:00:00.000Z",
    end: "2030-01-15T11:00:00.000Z",
    isAllDay: false,
    attendees: [{ email: "a@example.com", displayName: "Alex", responseStatus: "accepted" }],
    organizer: { email: "organizer@example.com", displayName: "Org" },
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=evt-1",
    ...overrides,
  };
}

describe("calendar sync API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanDb();
    const { buildApp } = await import("../src/app.js");
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("syncs calendar events into the database and returns a summary", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/sync",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fetched: 1, created: 1, updated: 0 });

    const stored = await prisma.calendarEvent.findMany({ where: { userId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.providerEventId).toBe("evt-1");
    expect(stored[0]?.title).toBe("Launch review");
    expect(JSON.parse(stored[0]?.attendeeEmails ?? "[]")).toEqual(["a@example.com"]);
  });

  it("is idempotent: syncing the same calendar data twice does not create duplicate rows", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/sync",
    });
    expect(first.json()).toEqual({ fetched: 1, created: 1, updated: 0 });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/sync",
    });
    expect(second.json()).toEqual({ fetched: 1, created: 0, updated: 1 });

    const count = await prisma.calendarEvent.count({ where: { userId } });
    expect(count).toBe(1);
  });

  it("updates the stored record when Calendar returns changed data (e.g. status)", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/sync" });

    listUpcomingEvents.mockResolvedValue([calendarEvent({ status: "tentative" })]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/sync" });

    const stored = await prisma.calendarEvent.findUnique({
      where: {
        userId_calendarId_providerEventId: {
          userId,
          calendarId: "primary",
          providerEventId: "evt-1",
        },
      },
    });
    expect(stored?.status).toBe("tentative");
  });

  it("persists an all-day event correctly through the full sync flow", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([
      calendarEvent({ id: "evt-allday", isAllDay: true, start: "2030-02-01", end: "2030-02-02" }),
    ]);

    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/sync" });

    const stored = await prisma.calendarEvent.findUnique({
      where: {
        userId_calendarId_providerEventId: {
          userId,
          calendarId: "primary",
          providerEventId: "evt-allday",
        },
      },
    });
    expect(stored?.isAllDay).toBe(true);
    expect(stored?.startAt.toISOString()).toBe("2030-02-01T00:00:00.000Z");
  });

  it("requires a Google connection before syncing", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/sync",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
    expect(await prisma.calendarEvent.count()).toBe(0);
  });

  it("rejects a limit above the safe maximum", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/sync?limit=9999",
    });

    expect(res.statusCode).toBe(400);
  });

  it("does not return event contents from the sync endpoint, only the summary", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/sync",
    });

    expect(Object.keys(res.json()).sort()).toEqual(["created", "fetched", "updated"]);
    expect(res.body).not.toMatch(/Launch review|Conference Room/i);
  });

  it("never exposes tokens or secrets from the sync endpoint", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/calendar/sync",
    });

    expect(res.body).not.toMatch(/super-secret|refreshToken|accessToken|Encrypted/i);
  });

  it("lists persisted events via the stored-events endpoint", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/sync" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/stored-events",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      calendarId: "primary",
      summary: "Launch review",
      location: "Conference Room A",
      isAllDay: false,
      status: "confirmed",
      organizer: { email: "organizer@example.com", displayName: "Org" },
    });
  });

  it("stored-events reflects only this user's persisted events", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/calendar/sync" });

    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/stored-events",
      headers: { "x-user-id": otherUser.id },
    });

    expect(res.json().events).toEqual([]);
  });
});
