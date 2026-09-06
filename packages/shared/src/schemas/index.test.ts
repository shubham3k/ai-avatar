import { describe, it, expect } from "vitest";
import {
  prioritySchema,
  signalTypeSchema,
  signalStatusSchema,
  interventionStatusSchema,
  healthResponseSchema,
} from ".";

describe("shared schemas", () => {
  describe("prioritySchema", () => {
    it("accepts valid priorities", () => {
      expect(prioritySchema.parse("low")).toBe("low");
      expect(prioritySchema.parse("medium")).toBe("medium");
      expect(prioritySchema.parse("high")).toBe("high");
      expect(prioritySchema.parse("critical")).toBe("critical");
    });

    it("rejects invalid priorities", () => {
      expect(() => prioritySchema.parse("invalid")).toThrow();
    });
  });

  describe("signalTypeSchema", () => {
    it("accepts valid signal types", () => {
      expect(signalTypeSchema.parse("reply_needed")).toBe("reply_needed");
      expect(signalTypeSchema.parse("approval_needed")).toBe("approval_needed");
      expect(signalTypeSchema.parse("deadline")).toBe("deadline");
      expect(signalTypeSchema.parse("upcoming_meeting")).toBe("upcoming_meeting");
      expect(signalTypeSchema.parse("follow_up")).toBe("follow_up");
    });

    it("rejects invalid signal types", () => {
      expect(() => signalTypeSchema.parse("invalid")).toThrow();
    });
  });

  describe("signalStatusSchema", () => {
    it("accepts valid signal statuses", () => {
      expect(signalStatusSchema.parse("open")).toBe("open");
      expect(signalStatusSchema.parse("resolved")).toBe("resolved");
      expect(signalStatusSchema.parse("ignored")).toBe("ignored");
    });

    it("rejects invalid signal statuses", () => {
      expect(() => signalStatusSchema.parse("invalid")).toThrow();
    });
  });

  describe("interventionStatusSchema", () => {
    it("accepts valid intervention statuses", () => {
      expect(interventionStatusSchema.parse("pending")).toBe("pending");
      expect(interventionStatusSchema.parse("snoozed")).toBe("snoozed");
      expect(interventionStatusSchema.parse("resolved")).toBe("resolved");
      expect(interventionStatusSchema.parse("dismissed")).toBe("dismissed");
    });

    it("rejects invalid intervention statuses", () => {
      expect(() => interventionStatusSchema.parse("invalid")).toThrow();
    });
  });

  describe("healthResponseSchema", () => {
    it("accepts valid health response", () => {
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
});