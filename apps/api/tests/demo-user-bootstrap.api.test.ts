import { afterAll, describe, expect, it } from "vitest";
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

/**
 * This app is single-user — every route falls back to the one demo user
 * when no x-user-id header is sent, which the desktop app never sends.
 * Without this row, "Connect Google" itself fails on a genuinely fresh
 * install (an empty, freshly-migrated database has tables but no rows) —
 * this is what auto-creates it, so no separate manual seed step is needed.
 */
describe("demo user bootstrap", () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("creates the demo user automatically on server start, with no prior seed", async () => {
    await cleanDb();
    expect(await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } })).toBeNull();

    app = buildApp();
    await app.ready();

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(DEMO_USER_EMAIL);
  });

  it("lets /integrations/google/connect resolve a caller on a database that was never manually seeded", async () => {
    await cleanDb();
    app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/connect",
    });

    // No Google OAuth env configured in tests, so this 400s on config, not
    // on "no user available" — the point is it gets past caller resolution
    // at all, which used to require a manual `pnpm db:demo-tasks` seed.
    expect(res.statusCode).not.toBe(500);
    const body = res.json() as { error?: { message?: string } };
    expect(body.error?.message).not.toMatch(/no user is available/i);
  });

  it("is idempotent — running it again on an already-seeded database doesn't duplicate or error", async () => {
    await cleanDb();
    app = buildApp();
    await app.ready();
    const first = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });

    const secondApp = buildApp();
    await secondApp.ready();
    await secondApp.close();

    const usersWithThatEmail = await prisma.user.findMany({ where: { email: DEMO_USER_EMAIL } });
    expect(usersWithThatEmail).toHaveLength(1);
    expect(usersWithThatEmail[0]?.id).toBe(first?.id);
  });
});
