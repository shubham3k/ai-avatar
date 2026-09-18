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
    fromEmail: "colleague@example.com",
    fromName: "Jamie",
    toEmails: [DEMO_USER_EMAIL],
    subject: "Need your feedback",
    snippet: "Can you review this by tomorrow?",
    receivedAt: new Date(),
    isRead: false,
    labels: ["INBOX", "UNREAD"] as string[],
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

describe("gmail signal detection API", () => {
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

  it("returns zero counts when there are no stored emails", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/detect-signals",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      analyzed: 0,
      actionable: 0,
      signalsCreated: 0,
      interventionsCreated: 0,
    });
  });

  it("does not create signals for non-actionable emails", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId, {
      subject: "Weekly newsletter",
      snippet: "Here's what happened this week.",
      fromEmail: "newsletter@brand.com",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/detect-signals",
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

  it("creates a signal and intervention for an actionable email", async () => {
    const userId = await ensureDemoUser();
    const email = await createEmail(userId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/detect-signals",
    });

    expect(res.json()).toEqual({
      analyzed: 1,
      actionable: 1,
      signalsCreated: 1,
      interventionsCreated: 1,
    });

    const signal = await prisma.signal.findFirst({ where: { userId } });
    expect(signal?.type).toBe("user_action_required");
    expect(signal?.sourceType).toBe("email");
    expect(signal?.sourceId).toBe(email.id);

    const intervention = await prisma.intervention.findUnique({
      where: { signalId: signal!.id },
    });
    expect(intervention?.status).toBe("pending");
    expect(intervention?.priority).toBe("high");
    expect(intervention?.message).toMatch(/Jamie/);
    expect(intervention?.message).not.toMatch(/you have a new email/i);
  });

  it("is idempotent: running detection twice does not duplicate signals or interventions", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId);

    await app.inject({ method: "POST", url: "/api/v1/integrations/google/gmail/detect-signals" });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/detect-signals",
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
    await createEmail(userId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/detect-signals?limit=9999",
    });

    expect(res.statusCode).toBe(400);
  });

  it("the generated intervention flows through the existing inbox/Done/Snooze lifecycle", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId);

    await app.inject({ method: "POST", url: "/api/v1/integrations/google/gmail/detect-signals" });

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

  it("never returns email content, only the summary", async () => {
    const userId = await ensureDemoUser();
    await createEmail(userId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/detect-signals",
    });

    expect(Object.keys(res.json()).sort()).toEqual([
      "actionable",
      "analyzed",
      "interventionsCreated",
      "signalsCreated",
    ]);
    expect(res.body).not.toMatch(/Jamie|feedback|snippet/i);
  });
});
