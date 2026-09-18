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
  await prisma.goal.deleteMany();
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

describe("goals API", () => {
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

  it("creates a goal", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      payload: { title: "Launch my product", description: "Ship v1 by Q4" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      title: "Launch my product",
      description: "Ship v1 by Q4",
      active: true,
    });
    expect(typeof body.id).toBe("string");
  });

  it("rejects an empty title with a validation error", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      payload: { title: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("lists only active goals by default", async () => {
    const userId = await ensureDemoUser();
    await prisma.goal.create({
      data: { userId, title: "Active goal", active: true },
    });
    await prisma.goal.create({
      data: { userId, title: "Inactive goal", active: false },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/goals" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goals).toHaveLength(1);
    expect(body.goals[0].title).toBe("Active goal");
  });

  it("lists all goals when includeInactive=true", async () => {
    const userId = await ensureDemoUser();
    await prisma.goal.create({ data: { userId, title: "Active goal", active: true } });
    await prisma.goal.create({ data: { userId, title: "Inactive goal", active: false } });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/goals?includeInactive=true",
    });

    expect(res.json().goals).toHaveLength(2);
  });

  it("updates a goal's title/description", async () => {
    const userId = await ensureDemoUser();
    const goal = await prisma.goal.create({
      data: { userId, title: "Old title" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}`,
      payload: { title: "New title", description: "New description" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: goal.id,
      title: "New title",
      description: "New description",
    });
  });

  it("deactivates a goal", async () => {
    const userId = await ensureDemoUser();
    const goal = await prisma.goal.create({ data: { userId, title: "Some goal" } });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}`,
      payload: { active: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().active).toBe(false);

    const listRes = await app.inject({ method: "GET", url: "/api/v1/goals" });
    expect(listRes.json().goals).toHaveLength(0);
  });

  it("returns not_found when updating a goal that doesn't exist", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/goals/does-not-exist",
      payload: { active: false },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("does not let one user update another user's goal", async () => {
    const userId = await ensureDemoUser();
    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });
    const goal = await prisma.goal.create({
      data: { userId: otherUser.id, title: "Other user's goal" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${goal.id}`,
      payload: { active: false },
      headers: { "x-user-id": userId },
    });

    expect(res.statusCode).toBe(404);
  });

  it("does not create any Signal or Intervention rows", async () => {
    await ensureDemoUser();

    await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      payload: { title: "Some goal" },
    });

    expect(await prisma.signal.count()).toBe(0);
    expect(await prisma.intervention.count()).toBe(0);
  });
});
