import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { upstreamError } from "../src/lib/errors.js";
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

function calendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    calendarId: "primary",
    summary: "Launch review",
    description: null,
    location: null,
    start: "2026-09-15T10:00:00-07:00",
    end: "2026-09-15T11:00:00-07:00",
    isAllDay: false,
    attendees: [],
    organizer: null,
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=evt_1",
    ...overrides,
  };
}

describe("calendar events API", () => {
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

  it("returns normalized events when Google is connected", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([calendarEvent()]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [calendarEvent()] });
  });

  it("passes the limit query param through and enforces the safe maximum", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events?limit=1000",
    });

    // The shared query schema caps `limit` at 25 and rejects out-of-range input.
    expect(res.statusCode).toBe(400);
  });

  it("respects a valid limit query param", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events?limit=3",
    });

    expect(res.statusCode).toBe(200);
    expect(listUpcomingEvents).toHaveBeenCalledWith(expect.any(String), 3, expect.any(Date));
  });

  it("returns a clean not_found error when Google is not connected", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("never exposes tokens or secrets in the response", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events",
    });

    expect(res.body).not.toMatch(/super-secret|refreshToken|accessToken|Encrypted/i);
  });

  it("maps a Calendar provider auth failure to a safe 403 without leaking details", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockRejectedValue(
      Object.assign(
        new Error("Google authorization is invalid or has expired. Reconnect your Google account."),
        { code: "forbidden", statusCode: 403 },
      ),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events",
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toMatch(/client_secret|refresh_token/i);
  });

  it("maps a Calendar API failure to a safe 502 without leaking details", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listUpcomingEvents.mockRejectedValue(
      upstreamError("Calendar is temporarily unavailable. Try again shortly."),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events",
    });

    expect(res.statusCode).toBe(502);
  });

  it("reuses the existing x-user-id / demo-user resolution mechanism", async () => {
    await ensureDemoUser();
    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });
    await connectGoogle(otherUser.id);
    listUpcomingEvents.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/calendar/events",
      headers: { "x-user-id": otherUser.id },
    });

    expect(res.statusCode).toBe(200);
  });
});
