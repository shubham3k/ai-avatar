import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import {
  DEMO_PROVIDER_EVENT_ID,
  DEMO_PROVIDER_MESSAGE_ID,
  ensureDemoData,
} from "../src/demo/demo-scenario.js";
import { createDemoPipelineService } from "../src/domain/pipeline.service.js";

async function cleanDb(db: PrismaClient) {
  await db.intervention.deleteMany();
  await db.signal.deleteMany();
  await db.email.deleteMany();
  await db.calendarEvent.deleteMany();
  await db.agentRun.deleteMany();
  await db.integration.deleteMany();
  await db.user.deleteMany();
}

async function countDemoEntities() {
  const [users, emails, events, signals, interventions] = await Promise.all([
    prisma.user.count(),
    prisma.email.count(),
    prisma.calendarEvent.count(),
    prisma.signal.count(),
    prisma.intervention.count(),
  ]);
  return { users, emails, events, signals, interventions };
}

describe("demo pipeline", () => {
  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates demo data idempotently", async () => {
    const first = await ensureDemoData(prisma);
    const second = await ensureDemoData(prisma);

    expect(second.user.id).toBe(first.user.id);
    expect(second.email.id).toBe(first.email.id);
    expect(second.calendarEvent.id).toBe(first.calendarEvent.id);

    const counts = await countDemoEntities();
    expect(counts.users).toBe(1);
    expect(counts.emails).toBe(1);
    expect(counts.events).toBe(1);

    const email = await prisma.email.findUnique({
      where: {
        userId_providerMessageId: {
          userId: first.user.id,
          providerMessageId: DEMO_PROVIDER_MESSAGE_ID,
        },
      },
    });
    expect(email?.subject).toContain("Final approval needed");
  });

  it("generates the demo signal exactly once", async () => {
    const pipeline = createDemoPipelineService();
    const first = await pipeline.run();
    expect(first.signalCreated).toBe(true);
    expect(first.signalId).not.toBeNull();

    const second = await pipeline.run();
    expect(second.signalCreated).toBe(false);
    expect(second.signalId).toBe(first.signalId);

    const signals = await prisma.signal.findMany();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.type).toBe("user_action_required");
    expect(signals[0]?.status).toBe("open");
  });

  it("generates the demo intervention exactly once", async () => {
    const pipeline = createDemoPipelineService();
    const first = await pipeline.run();
    expect(first.interventionCreated).toBe(true);

    const second = await pipeline.run();
    expect(second.interventionCreated).toBe(false);
    expect(second.interventionId).toBe(first.interventionId);

    const interventions = await prisma.intervention.findMany();
    expect(interventions).toHaveLength(1);
    expect(interventions[0]?.priority).toBe("high");
    expect(interventions[0]?.title).toBe(
      "Design team is waiting for your feedback",
    );
    expect(interventions[0]?.status).toBe("pending");
  });

  it("does not create duplicates when the full flow runs twice", async () => {
    const pipeline = createDemoPipelineService();
    await pipeline.run();
    await pipeline.run();

    const counts = await countDemoEntities();
    expect(counts).toEqual({
      users: 1,
      emails: 1,
      events: 1,
      signals: 1,
      interventions: 1,
    });

    const event = await prisma.calendarEvent.findFirst();
    expect(event?.title).toBe("Product Launch");
    expect(event?.providerEventId).toBe(DEMO_PROVIDER_EVENT_ID);
  });
});
