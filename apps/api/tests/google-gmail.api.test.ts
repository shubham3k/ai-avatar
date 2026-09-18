import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEMO_USER_EMAIL } from "../src/demo/demo-scenario.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { prisma } from "../src/lib/prisma.js";

const listRecentMessages = vi.fn();

vi.mock("../src/providers/google/gmail/gmail.service.js", () => ({
  createGmailService: () => ({ listRecentMessages }),
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
      scopes: JSON.stringify(["gmail.readonly"]),
    },
  });
}

describe("gmail messages API", () => {
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

  it("returns normalized messages when Google is connected", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([
      {
        id: "m1",
        threadId: "t1",
        subject: "Final approval needed",
        from: "design-team@example.com",
        to: "demo@example.local",
        date: "2026-09-01T10:00:00.000Z",
        snippet: "Please approve",
        labels: ["INBOX"],
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/messages",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      messages: [
        {
          id: "m1",
          threadId: "t1",
          subject: "Final approval needed",
          from: "design-team@example.com",
          to: "demo@example.local",
          date: "2026-09-01T10:00:00.000Z",
          snippet: "Please approve",
          labels: ["INBOX"],
        },
      ],
    });
  });

  it("passes the limit query param through and enforces the safe maximum", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/messages?limit=1000",
    });

    // The shared query schema caps `limit` at 25 and rejects out-of-range input.
    expect(res.statusCode).toBe(400);
  });

  it("respects a valid limit query param", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/messages?limit=3",
    });

    expect(res.statusCode).toBe(200);
    expect(listRecentMessages).toHaveBeenCalledWith(expect.any(String), 3);
  });

  it("returns a clean not_found error when Google is not connected", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/messages",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("never exposes tokens or secrets in the response", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/messages",
    });

    expect(res.body).not.toMatch(/super-secret|refreshToken|accessToken|Encrypted/i);
  });

  it("maps a Gmail provider auth failure to a safe 403 without leaking details", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockRejectedValue(
      Object.assign(
        new Error("Google authorization is invalid or has expired. Reconnect your Google account."),
        { code: "forbidden", statusCode: 403 },
      ),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/messages",
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toMatch(/client_secret|refresh_token/i);
  });

  it("reuses the existing x-user-id / demo-user resolution mechanism", async () => {
    await ensureDemoUser();
    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });
    await connectGoogle(otherUser.id);
    listRecentMessages.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/messages",
      headers: { "x-user-id": otherUser.id },
    });

    expect(res.statusCode).toBe(200);
  });
});
