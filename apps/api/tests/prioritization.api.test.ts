import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { prisma } from "../src/lib/prisma.js";

const createStructuredCompletion = vi.fn();

// Every domain service gets its provider from createLlmProvider (OpenAI with
// Groq fallback, ADR-006) — mock that single seam.
vi.mock("../src/providers/llm/create-llm-provider.js", () => ({
  createLlmProvider: () => ({ createStructuredCompletion, transcribeAudio: vi.fn() }),
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
    snippet: "top secret snippet content",
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

async function createEmailSignal(userId: string, emailId: string) {
  return prisma.signal.create({
    data: {
      userId,
      type: "user_action_required",
      sourceType: "email",
      sourceId: emailId,
      title: "John needs your response",
      summary: "John appears to need a response.",
      status: "open",
      importanceHints: JSON.stringify({ confidence: "medium" }),
    },
  });
}

async function createCalendarSignal(userId: string, eventId: string, startAt: Date) {
  return prisma.signal.create({
    data: {
      userId,
      type: "user_action_required",
      sourceType: "calendar_event",
      sourceId: eventId,
      title: "Acme proposal review",
      summary: "Acme proposal review starts soon.",
      status: "open",
      dueAt: startAt,
      importanceHints: JSON.stringify({ confidence: "high" }),
    },
  });
}

async function setupConsolidatedSituation(userId: string) {
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
  return { email, event, emailSignal, calendarSignal };
}

describe("prioritization API", () => {
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

  it("returns an empty result and never calls the AI provider when there are no situations", async () => {
    await ensureDemoUser();

    const res = await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ prioritizedSituations: [] });
    expect(createStructuredCompletion).not.toHaveBeenCalled();
  });

  it("returns a structured prioritization result for a consolidated situation", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockImplementation(async (request: { jsonSchema: unknown }) => {
      const schema = request.jsonSchema as {
        properties: { prioritizedSituations: { items: { properties: { situationId: { enum: string[] } } } } };
      };
      const [actualId] = schema.properties.prioritizedSituations.items.properties.situationId.enum;
      return JSON.stringify({
        prioritizedSituations: [
          {
            situationId: actualId,
            priority: "high",
            reason: "Meeting is soon and the email requests feedback beforehand.",
            recommendedAction: "Reply with feedback before the meeting.",
          },
        ],
      });
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prioritizedSituations).toHaveLength(1);
    expect(body.prioritizedSituations[0]).toMatchObject({
      priority: "high",
      reason: "Meeting is soon and the email requests feedback beforehand.",
      recommendedAction: "Reply with feedback before the meeting.",
    });
  });

  it("sends the daily-context fields (Phase 3.2) and active goals (Phase 3.4) to the AI provider", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    await prisma.goal.create({
      data: { userId, title: "Launch my product", description: "v1 by Q4" },
    });
    createStructuredCompletion.mockResolvedValue(
      JSON.stringify({ prioritizedSituations: [] }),
    );

    await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    const call = (createStructuredCompletion as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const sentInput = JSON.parse(call.input);
    expect(typeof sentInput.currentTime).toBe("string");
    expect(Array.isArray(sentInput.upcomingEvents)).toBe(true);
    expect(Array.isArray(sentInput.relevantEmails)).toBe(true);
    expect(sentInput.goals).toEqual([
      { id: expect.any(String), title: "Launch my product", description: "v1 by Q4" },
    ]);
  });

  it("returns a clean error when the AI provider fails", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockRejectedValue(new Error("Groq is temporarily unavailable."));

    const res = await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("upstream_error");
  });

  it("returns a clean error when the AI response is malformed", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockResolvedValue("not valid json");

    const res = await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("upstream_error");
  });

  it("does not create any Signal rows", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockResolvedValue(JSON.stringify({ prioritizedSituations: [] }));
    const countBefore = await prisma.signal.count();

    await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    expect(await prisma.signal.count()).toBe(countBefore);
  });

  it("does not create any Intervention rows", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockResolvedValue(JSON.stringify({ prioritizedSituations: [] }));

    await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    expect(await prisma.intervention.count()).toBe(0);
  });

  it("never sends credentials or full email/calendar content to the AI request, and never returns them", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockResolvedValue(JSON.stringify({ prioritizedSituations: [] }));

    const res = await app.inject({ method: "GET", url: "/api/v1/prioritization" });

    const sentInput = createStructuredCompletion.mock.calls[0]?.[0]?.input as string;
    expect(sentInput).not.toMatch(/Sensitive internal notes/i);
    expect(sentInput).toContain("top secret snippet content"); // snippet is allowed (bounded, already stored)
    expect(res.body).not.toMatch(/refreshToken|accessToken|Encrypted|GROQ_API_KEY/i);
  });
});
