import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  it("shows 'just now' for anything under 5 seconds", () => {
    expect(formatRelativeTime(1000, 1000)).toBe("just now");
    expect(formatRelativeTime(1000, 4999)).toBe("just now");
  });

  it("shows seconds under a minute", () => {
    expect(formatRelativeTime(0, 30_000)).toBe("30s ago");
  });

  it("shows minutes under an hour", () => {
    expect(formatRelativeTime(0, 3 * 60_000)).toBe("3m ago");
  });

  it("shows hours for an hour or more", () => {
    expect(formatRelativeTime(0, 2 * 60 * 60_000)).toBe("2h ago");
  });

  it("never goes negative for a clock that moved backwards slightly", () => {
    expect(formatRelativeTime(1000, 500)).toBe("just now");
  });
});
