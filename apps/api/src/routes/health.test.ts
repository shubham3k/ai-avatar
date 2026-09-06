import { describe, it, expect } from "vitest";
import { healthResponseSchema } from "@ai-agent/shared";

describe("health routes schema", () => {
  it("validates health response", () => {
    const valid = {
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      service: "api",
    };
    expect(healthResponseSchema.parse(valid)).toEqual(valid);
  });

  it("rejects invalid status", () => {
    expect(() =>
      healthResponseSchema.parse({
        status: "error",
        timestamp: new Date().toISOString(),
        service: "api",
      }),
    ).toThrow();
  });
});