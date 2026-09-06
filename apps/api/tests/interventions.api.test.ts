import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { createDemoPipelineService } from "../src/domain/pipeline.service.js";
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

async function seedDemoIntervention() {
  const pipeline = createDemoPipelineService();
  const result = await pipeline.run();
  if (!result.interventionId) throw new Error("Demo intervention not created");
  return result;
}

async function createOtherUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: "other@example.local",
      displayName: "Other User",
      timezone: "UTC",
    },
  });
  return user.id;
}

describe("interventions API", () => {
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

  it("returns the demo intervention in the inbox", async () => {
    const seeded = await seedDemoIntervention();

    const res = await app.inject({ method: "GET", url: "/api/v1/interventions" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(seeded.interventionId);
    expect(body.items[0].priority).toBe("high");
    expect(body.items[0].status).toBe("pending");
    expect(body.items[0].title).toBe(
      "Design team is waiting for your feedback",
    );
  });

  it("resolves an intervention and is idempotent when resolved twice", async () => {
    const seeded = await seedDemoIntervention();
    const url = `/api/v1/interventions/${seeded.interventionId}/done`;

    const first = await app.inject({
      method: "POST",
      url,
      payload: {},
      headers: { "x-user-id": "" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("resolved");
    expect(first.json().resolvedAt).not.toBeNull();

    const second = await app.inject({ method: "POST", url, payload: {} });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(seeded.interventionId);
    expect(second.json().resolvedAt).toBe(first.json().resolvedAt);

    const count = await prisma.intervention.count({
      where: { status: "resolved" },
    });
    expect(count).toBe(1);
  });

  it("snoozes an intervention with a future snooze time", async () => {
    const seeded = await seedDemoIntervention();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${seeded.interventionId}/snooze`,
      payload: { minutes: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("snoozed");

    const snoozedUntil = new Date(res.json().snoozedUntil);
    expect(snoozedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects invalid or non-positive snooze durations", async () => {
    const seeded = await seedDemoIntervention();

    for (const minutes of [0, -5, 1.5, "abc"]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/interventions/${seeded.interventionId}/snooze`,
        payload: { minutes },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("validation_error");
    }

    const unchanged = await prisma.intervention.findUnique({
      where: { id: seeded.interventionId! },
    });
    expect(unchanged?.status).toBe("pending");
    expect(unchanged?.snoozedUntil).toBeNull();
  });

  it("hides a snoozed intervention from the inbox until expiry", async () => {
    const seeded = await seedDemoIntervention();

    const snoozeRes = await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${seeded.interventionId}/snooze`,
      payload: { minutes: 120 },
    });
    expect(snoozeRes.statusCode).toBe(200);

    const inbox = await app.inject({ method: "GET", url: "/api/v1/interventions" });
    expect(inbox.json().items).toHaveLength(0);

    // Simulate snooze expiry.
    await prisma.intervention.update({
      where: { id: seeded.interventionId },
      data: { snoozedUntil: new Date(Date.now() - 1000) },
    });

    const afterExpiry = await app.inject({
      method: "GET",
      url: "/api/v1/interventions",
    });
    expect(afterExpiry.json().items).toHaveLength(1);
    expect(afterExpiry.json().items[0].id).toBe(seeded.interventionId);
  });

  it("prevents another user from accessing or mutating the intervention", async () => {
    const seeded = await seedDemoIntervention();
    const otherUserId = await createOtherUser();

    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/interventions/${seeded.interventionId}`,
      headers: { "x-user-id": otherUserId },
    });
    expect(getRes.statusCode).toBe(404);

    const doneRes = await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${seeded.interventionId}/done`,
      headers: { "x-user-id": otherUserId },
      payload: {},
    });
    expect(doneRes.statusCode).toBe(404);

    const snoozeRes = await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${seeded.interventionId}/snooze`,
      headers: { "x-user-id": otherUserId },
      payload: { minutes: 30 },
    });
    expect(snoozeRes.statusCode).toBe(404);

    const unchanged = await prisma.intervention.findUnique({
      where: { id: seeded.interventionId },
    });
    expect(unchanged?.status).toBe("pending");

    const ownerInbox = await app.inject({
      method: "GET",
      url: "/api/v1/interventions",
      headers: { "x-user-id": otherUserId },
    });
    expect(ownerInbox.json().items).toHaveLength(0);

    const demoUser = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
    });
    expect(demoUser?.email).toBe(DEMO_USER_EMAIL);
  });
});
