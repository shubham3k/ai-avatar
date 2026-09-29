import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

describe("usage API (ADR-006)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await prisma.llmUsage.deleteMany();
    app ??= await buildApp();
  });

  afterAll(async () => {
    await prisma.llmUsage.deleteMany();
    await app?.close();
  });

  it("GET /usage/summary reports zero usage when nothing has been recorded", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/usage/summary" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      calls: 0,
      estimatedCostUsd: 0,
      openai: { calls: 0, costUsd: null },
      groq: { calls: 0, costUsd: null },
    });
  });

  it("GET /usage/summary totals this month's calls per provider, ignoring earlier months", async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await prisma.llmUsage.createMany({
      data: [
        { provider: "openai", model: "gpt-6-luna", operation: "reminder_parse", inputTokens: 900, outputTokens: 60, costUsd: 0.0001 },
        { provider: "openai", model: "gpt-4o-mini-transcribe", operation: "transcription", audioSeconds: 6, costUsd: 0.0003 },
        { provider: "groq", model: "openai/gpt-oss-120b", operation: "reminder_parse", costUsd: null },
        { provider: "openai", model: "gpt-6-luna", operation: "other", costUsd: 5, createdAt: lastMonth },
      ],
    });

    const body = (await app.inject({ method: "GET", url: "/api/v1/usage/summary" })).json();

    expect(body).toMatchObject({ calls: 3, openai: { calls: 2 }, groq: { calls: 1, costUsd: null } });
    expect(body.estimatedCostUsd).toBeCloseTo(0.0004, 10);
  });
});
