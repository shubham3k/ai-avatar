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
  await prisma.reminder.deleteMany();
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

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe("reminders API", () => {
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

  it("creates a reminder", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders",
      payload: { text: "Call the vendor about pricing", dueAt: FUTURE },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ text: "Call the vendor about pricing", dueAt: FUTURE });
    expect(typeof body.id).toBe("string");
  });

  it("rejects an empty text with a validation error", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders",
      payload: { text: "", dueAt: FUTURE },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("POST /from-text surfaces a clear error when Groq isn't configured (the isolated test env has no GROQ_API_KEY)", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders/from-text",
      payload: { text: "remind me to drink water at 4pm" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Add your Groq API key in Settings/);
    expect(await prisma.reminder.count()).toBe(0);
  });

  it("POST /from-voice surfaces a clear error when Groq isn't configured (the isolated test env has no GROQ_API_KEY)", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders/from-voice",
      payload: {
        audioBase64: Buffer.from("fake audio bytes").toString("base64"),
        mimeType: "audio/webm",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Add your Groq API key in Settings/);
    expect(await prisma.reminder.count()).toBe(0);
  });

  it("POST /from-voice rejects an empty audio payload with a validation error", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders/from-voice",
      payload: { audioBase64: "", mimeType: "audio/webm" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("rejects a due date in the past", async () => {
    await ensureDemoUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders",
      payload: { text: "Something", dueAt: PAST },
    });

    expect(res.statusCode).toBe(400);
  });

  it("lists reminders soonest-due first", async () => {
    const userId = await ensureDemoUser();
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const sooner = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.reminder.create({ data: { userId, text: "Later", dueAt: later } });
    await prisma.reminder.create({ data: { userId, text: "Sooner", dueAt: sooner } });

    const res = await app.inject({ method: "GET", url: "/api/v1/reminders" });

    expect(res.statusCode).toBe(200);
    const { reminders } = res.json();
    expect(reminders.map((r: { text: string }) => r.text)).toEqual(["Sooner", "Later"]);
  });

  it("deletes a reminder", async () => {
    const userId = await ensureDemoUser();
    const reminder = await prisma.reminder.create({
      data: { userId, text: "Delete me", dueAt: new Date(FUTURE) },
    });

    const res = await app.inject({ method: "DELETE", url: `/api/v1/reminders/${reminder.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });
    expect(await prisma.reminder.count()).toBe(0);
  });

  it("returns not_found when deleting a reminder that doesn't exist", async () => {
    await ensureDemoUser();

    const res = await app.inject({ method: "DELETE", url: "/api/v1/reminders/does-not-exist" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("does not let one user delete another user's reminder", async () => {
    const userId = await ensureDemoUser();
    const otherUser = await prisma.user.create({
      data: { email: "other@example.local", displayName: "Other", timezone: "UTC" },
    });
    const reminder = await prisma.reminder.create({
      data: { userId: otherUser.id, text: "Not yours", dueAt: new Date(FUTURE) },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/reminders/${reminder.id}`,
      headers: { "x-user-id": userId },
    });

    expect(res.statusCode).toBe(404);
  });

  it("detect-signals creates an intervention once a reminder is due, idempotently", async () => {
    const userId = await ensureDemoUser();
    const reminder = await prisma.reminder.create({
      data: { userId, text: "Follow up with Sam", dueAt: new Date(PAST) },
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/reminders/detect-signals",
    });
    expect(first.json()).toEqual({ analyzed: 1, interventionsCreated: 1 });

    const signal = await prisma.signal.findFirst({ where: { userId } });
    expect(signal?.sourceType).toBe("reminder");
    expect(signal?.sourceId).toBe(reminder.id);

    const intervention = await prisma.intervention.findUnique({
      where: { signalId: signal!.id },
    });
    expect(intervention?.priority).toBe("medium");
    expect(intervention?.message).toBe("Follow up with Sam");

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/reminders/detect-signals",
    });
    expect(second.json()).toEqual({ analyzed: 1, interventionsCreated: 0 });
    expect(await prisma.intervention.count()).toBe(1);
  });

  it("does not create an intervention for a reminder that isn't due yet", async () => {
    const userId = await ensureDemoUser();
    await prisma.reminder.create({
      data: { userId, text: "Not due yet", dueAt: new Date(FUTURE) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reminders/detect-signals",
    });

    expect(res.json()).toEqual({ analyzed: 0, interventionsCreated: 0 });
  });

  it("the generated intervention flows through the existing inbox/Done/Snooze lifecycle", async () => {
    const userId = await ensureDemoUser();
    await prisma.reminder.create({
      data: { userId, text: "Due reminder", dueAt: new Date(PAST) },
    });

    await app.inject({ method: "POST", url: "/api/v1/reminders/detect-signals" });

    const inbox = await app.inject({ method: "GET", url: "/api/v1/interventions" });
    expect(inbox.json().items).toHaveLength(1);
    const interventionId = inbox.json().items[0].id;

    const doneRes = await app.inject({
      method: "POST",
      url: `/api/v1/interventions/${interventionId}/done`,
      payload: {},
    });
    expect(doneRes.statusCode).toBe(200);
    expect(doneRes.json().status).toBe("resolved");
  });
});
