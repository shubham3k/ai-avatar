import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { encryptSecret } from "../src/lib/crypto.js";
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

describe("google integration API", () => {
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

  it("reports disconnected when no Google integration exists", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/status",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      connected: false,
      provider: "google",
      email: null,
      scopes: [],
    });
  });

  it("reports connected status without ever exposing tokens", async () => {
    const userId = await ensureDemoUser();
    await prisma.integration.create({
      data: {
        userId,
        provider: "google",
        status: "connected",
        providerAccountId: "google-account-1",
        providerAccountEmail: "demo@example.local",
        refreshTokenEncrypted: encryptSecret("super-secret-refresh-token"),
        accessTokenEncrypted: encryptSecret("super-secret-access-token"),
        scopes: JSON.stringify(["openid", "email"]),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(true);
    expect(body.email).toBe("demo@example.local");
    const raw = res.body;
    expect(raw).not.toMatch(/super-secret/);
    expect(raw).not.toMatch(/refreshToken|accessToken|Encrypted/);
  });

  it("returns a clean validation error from /connect when Google OAuth is not configured", async () => {
    // The test .env intentionally leaves GOOGLE_CLIENT_ID/SECRET blank.
    await ensureDemoUser();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/connect",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("redirects /callback with an error status when Google reports an error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/callback?error=access_denied",
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("status=error");
  });

  it("redirects /callback with an error status when code or state is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/callback",
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("status=error");
  });

  it("redirects /callback with an error status when the state is invalid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/callback?code=abc&state=garbage",
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("status=error");
  });

  it("disconnects an existing Google integration", async () => {
    const userId = await ensureDemoUser();
    await prisma.integration.create({
      data: {
        userId,
        provider: "google",
        status: "connected",
        providerAccountId: "google-account-1",
        providerAccountEmail: "demo@example.local",
        refreshTokenEncrypted: encryptSecret("secret"),
        scopes: JSON.stringify([]),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/disconnect",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connected).toBe(false);

    const stored = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: "google" } },
    });
    expect(stored?.status).toBe("disabled");
  });

  it("disconnect is a no-op when nothing is connected", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/disconnect",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connected).toBe(false);
  });
});
