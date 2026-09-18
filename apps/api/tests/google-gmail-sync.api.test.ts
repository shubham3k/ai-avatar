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

function gmailMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    threadId: "thread-1",
    subject: "Final approval needed",
    from: "Design Team <design-team@example.com>",
    to: "demo@example.local",
    date: "2026-09-01T10:00:00.000Z",
    snippet: "Please approve the launch assets",
    labels: ["INBOX", "UNREAD"],
    internalDate: "1756721000000",
    ...overrides,
  };
}

describe("gmail sync API", () => {
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

  it("syncs Gmail messages into the database and returns a summary", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([gmailMessage()]);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/sync",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fetched: 1, created: 1, updated: 0 });

    const stored = await prisma.email.findMany({ where: { userId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.providerMessageId).toBe("msg-1");
    expect(stored[0]?.subject).toBe("Final approval needed");
  });

  it("is idempotent: syncing the same Gmail data twice does not create duplicate rows", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([gmailMessage()]);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/sync",
    });
    expect(first.json()).toEqual({ fetched: 1, created: 1, updated: 0 });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/sync",
    });
    expect(second.json()).toEqual({ fetched: 1, created: 0, updated: 1 });

    const count = await prisma.email.count({ where: { userId } });
    expect(count).toBe(1);
  });

  it("updates the stored record when Gmail returns changed data (e.g. read state)", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([gmailMessage()]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/gmail/sync" });

    listRecentMessages.mockResolvedValue([gmailMessage({ labels: ["INBOX"] })]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/gmail/sync" });

    const stored = await prisma.email.findUnique({
      where: { userId_providerMessageId: { userId, providerMessageId: "msg-1" } },
    });
    expect(JSON.parse(stored?.labels ?? "[]")).toEqual(["INBOX"]);
    expect(stored?.isRead).toBe(true);
  });

  it("requires a Google connection before syncing", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/sync",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");

    const count = await prisma.email.count();
    expect(count).toBe(0);
  });

  it("rejects a limit above the safe maximum", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/sync?limit=9999",
    });

    expect(res.statusCode).toBe(400);
  });

  it("does not return email contents from the sync endpoint, only the summary", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([gmailMessage()]);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/sync",
    });

    expect(Object.keys(res.json()).sort()).toEqual(["created", "fetched", "updated"]);
    expect(res.body).not.toMatch(/subject|snippet|Final approval/i);
  });

  it("never exposes tokens or secrets from the sync endpoint", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([gmailMessage()]);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/google/gmail/sync",
    });

    expect(res.body).not.toMatch(/super-secret|refreshToken|accessToken|Encrypted/i);
  });

  it("lists persisted messages via the stored-messages endpoint", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([gmailMessage()]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/gmail/sync" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/stored-messages",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      providerMessageId: "msg-1",
      threadId: "thread-1",
      fromEmail: "design-team@example.com",
      fromName: "Design Team",
      subject: "Final approval needed",
      isRead: false,
      labels: ["INBOX", "UNREAD"],
    });
  });

  it("stored-messages reflects only this user's persisted emails", async () => {
    const userId = await ensureDemoUser();
    await connectGoogle(userId);
    listRecentMessages.mockResolvedValue([gmailMessage()]);
    await app.inject({ method: "POST", url: "/api/v1/integrations/google/gmail/sync" });

    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google/gmail/stored-messages",
      headers: { "x-user-id": otherUser.id },
    });

    expect(res.json().messages).toEqual([]);
  });
});
