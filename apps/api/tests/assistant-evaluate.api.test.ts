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
  providerEventId?: string;
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
    providerEventId: `evt-${Math.random().toString(36).slice(2)}`,
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

function mockAiHighPriorityResponse() {
  createStructuredCompletion.mockImplementation(async (request: { jsonSchema: unknown }) => {
    const schema = request.jsonSchema as {
      properties: {
        prioritizedSituations: { items: { properties: { situationId: { enum: string[] } } } };
      };
    };
    const [situationId] = schema.properties.prioritizedSituations.items.properties.situationId.enum;
    return JSON.stringify({
      prioritizedSituations: [
        {
          situationId,
          priority: "high",
          reason: "The email requests the proposal before tomorrow's review.",
          recommendedAction: "Send the proposal before the meeting.",
        },
      ],
    });
  });
}

describe("assistant evaluate API", () => {
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

  it("returns an empty result when there are no consolidated situations", async () => {
    await ensureDemoUser();

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [] });
    expect(createStructuredCompletion).not.toHaveBeenCalled();
  });

  it("creates an intervention for an eligible high-priority situation", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ eligible: true, priority: "high", outcome: "created" });
    expect(body.results[0].interventionId).toBeTruthy();

    const stored = await prisma.intervention.findUnique({
      where: { id: body.results[0].interventionId },
    });
    expect(stored?.status).toBe("pending");
    expect(stored?.priority).toBe("high");
    const actionPayload = stored?.actionPayload
      ? (JSON.parse(stored.actionPayload) as { sourceUrl?: string })
      : null;
    expect(actionPayload?.sourceUrl).toBe(
      "https://calendar.google.com/event?eid=evt",
    );
  });

  it("reuses the intervention on a second evaluation instead of creating a duplicate", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();

    const first = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });
    const second = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(first.json().results[0].outcome).toBe("created");
    expect(second.json().results[0].outcome).toBe("reused");
    expect(second.json().results[0].interventionId).toBe(first.json().results[0].interventionId);
    expect(await prisma.intervention.count({ where: { userId } })).toBe(1);
  });

  it("respects an already-snoozed intervention by reusing it, not resurfacing a new one", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();
    const first = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });
    const interventionId = first.json().results[0].interventionId;

    await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${interventionId}/snooze`,
      payload: { minutes: 60 },
    });

    const second = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(second.json().results[0]).toMatchObject({ outcome: "reused", interventionId });
    expect(await prisma.intervention.count({ where: { userId } })).toBe(1);
  });

  it("respects an already-done intervention by reusing it, not recreating one", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();
    const first = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });
    const interventionId = first.json().results[0].interventionId;

    await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${interventionId}/done`,
      payload: {},
    });

    const second = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(second.json().results[0]).toMatchObject({ outcome: "reused", interventionId });
    expect(await prisma.intervention.count({ where: { userId } })).toBe(1);
  });

  it("does not mutate the stored intervention when the AI returns a different priority on re-evaluation (Phase 3.3)", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();
    const first = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });
    const interventionId = first.json().results[0].interventionId;

    // AI now claims "medium" for the same situation on a later evaluation.
    createStructuredCompletion.mockImplementation(async (request: { jsonSchema: unknown }) => {
      const schema = request.jsonSchema as {
        properties: {
          prioritizedSituations: { items: { properties: { situationId: { enum: string[] } } } };
        };
      };
      const [situationId] =
        schema.properties.prioritizedSituations.items.properties.situationId.enum;
      return JSON.stringify({
        prioritizedSituations: [
          { situationId, priority: "medium", reason: "changed", recommendedAction: "changed" },
        ],
      });
    });

    const second = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(second.json().results[0]).toMatchObject({ outcome: "reused", interventionId });
    const stored = await prisma.intervention.findUnique({ where: { id: interventionId } });
    // The application layer never rewrites an existing intervention on
    // reuse — the originally-created priority/message are left untouched,
    // so a changed AI opinion on a later call cannot silently alter
    // something already shown to (or acted on by) the user.
    expect(stored?.priority).toBe("high");
  });

  it("stays idempotent across three repeated evaluations — never more than one intervention (Phase 3.3)", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();

    await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });
    await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });
    await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(await prisma.intervention.count({ where: { userId } })).toBe(1);
  });

  it("surfaces an eligible medium-priority situation when the relationship is strong (attendee_match)", async () => {
    const userId = await ensureDemoUser();
    // setupConsolidatedSituation's email/event share an attendee, so the
    // Phase 2.6A relationship is "strong".
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockImplementation(async (request: { jsonSchema: unknown }) => {
      const schema = request.jsonSchema as {
        properties: {
          prioritizedSituations: { items: { properties: { situationId: { enum: string[] } } } };
        };
      };
      const [situationId] =
        schema.properties.prioritizedSituations.items.properties.situationId.enum;
      return JSON.stringify({
        prioritizedSituations: [
          { situationId, priority: "medium", reason: "r", recommendedAction: "a" },
        ],
      });
    });

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.json().results[0]).toMatchObject({ eligible: true, priority: "medium", outcome: "created" });
    expect(await prisma.intervention.count({ where: { userId } })).toBe(1);
  });

  it("does not surface a situation the AI response omitted", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockResolvedValue(JSON.stringify({ prioritizedSituations: [] }));

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.json().results[0]).toMatchObject({
      eligible: false,
      priority: null,
      outcome: "skipped",
    });
    expect(await prisma.intervention.count({ where: { userId } })).toBe(0);
  });

  it("keeps multiple independent situations independent (one surfaces, the other doesn't)", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    const email2 = await createEmail(userId, {
      fromEmail: "jane@other.com",
      subject: "Weekly digest",
      snippet: "nothing important",
    });
    const event2 = await createCalendarEvent(userId, {
      providerEventId: "evt-2",
      title: "Weekly digest review",
      attendeeEmails: [],
    });
    await createEmailSignal(userId, email2.id);
    await createCalendarSignal(userId, event2.id, event2.startAt);

    createStructuredCompletion.mockImplementation(async (request: { jsonSchema: unknown }) => {
      const schema = request.jsonSchema as {
        properties: {
          prioritizedSituations: { items: { properties: { situationId: { enum: string[] } } } };
        };
      };
      const ids = schema.properties.prioritizedSituations.items.properties.situationId.enum;
      return JSON.stringify({
        prioritizedSituations: ids.map((situationId) => ({
          situationId,
          priority: "high",
          reason: "r",
          recommendedAction: "a",
        })),
      });
    });

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.json().results).toHaveLength(2);
    expect(res.json().results.every((r: { outcome: string }) => r.outcome === "created")).toBe(true);
    expect(await prisma.intervention.count({ where: { userId } })).toBe(2);
  });

  it("does not surface a low-priority situation", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockImplementation(async (request: { jsonSchema: unknown }) => {
      const schema = request.jsonSchema as {
        properties: {
          prioritizedSituations: { items: { properties: { situationId: { enum: string[] } } } };
        };
      };
      const [situationId] =
        schema.properties.prioritizedSituations.items.properties.situationId.enum;
      return JSON.stringify({
        prioritizedSituations: [
          { situationId, priority: "low", reason: "r", recommendedAction: "a" },
        ],
      });
    });

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.json().results[0]).toMatchObject({ eligible: false, outcome: "skipped" });
    expect(await prisma.intervention.count({ where: { userId } })).toBe(0);
  });

  it("returns a clean error and creates nothing when AI prioritization fails", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    createStructuredCompletion.mockRejectedValue(new Error("Groq is temporarily unavailable."));

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("upstream_error");
    expect(await prisma.signal.count({ where: { userId } })).toBe(2); // only the two pre-existing signals
    expect(await prisma.intervention.count({ where: { userId } })).toBe(0);
  });

  it("creates no new Signal rows", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();
    const countBefore = await prisma.signal.count({ where: { userId } });

    await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(await prisma.signal.count({ where: { userId } })).toBe(countBefore);
  });

  it("never exposes credentials or unnecessary sensitive content in the response", async () => {
    const userId = await ensureDemoUser();
    await setupConsolidatedSituation(userId);
    mockAiHighPriorityResponse();

    const res = await app.inject({ method: "POST", url: "/api/v1/assistant/evaluate" });

    expect(res.body).not.toMatch(/Sensitive internal notes/i);
    expect(res.body).not.toMatch(/refreshToken|accessToken|Encrypted|GROQ_API_KEY/i);
  });
});
