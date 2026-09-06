import { describe, it, expect, vi } from "vitest";
import { registerJob, startJobs } from "./index.js";

describe("worker jobs", () => {
  it("registers jobs", () => {
    const handler = vi.fn();
    registerJob({ name: "test", schedule: "* * * * *", handler });
    expect(handler).not.toHaveBeenCalled();
  });

  it("starts jobs without error", () => {
    expect(() => startJobs()).not.toThrow();
  });
});