import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthState, verifyOAuthState } from "./state.js";

describe("OAuth state token", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips the userId", () => {
    const state = createOAuthState("user_123");
    expect(verifyOAuthState(state)).toBe("user_123");
  });

  it("produces a different token each time (nonce)", () => {
    const a = createOAuthState("user_123");
    const b = createOAuthState("user_123");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered payload", () => {
    const state = createOAuthState("user_123");
    const [, signature] = state.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: "attacker", nonce: "x", exp: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    expect(() => verifyOAuthState(`${forgedPayload}.${signature}`)).toThrow(
      /invalid/i,
    );
  });

  it("rejects a malformed state", () => {
    expect(() => verifyOAuthState("not-a-real-state")).toThrow(/Malformed/);
  });

  it("rejects an expired state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const state = createOAuthState("user_123");

    vi.setSystemTime(new Date("2026-01-01T00:11:00.000Z")); // +11 minutes, past the 10 minute TTL

    expect(() => verifyOAuthState(state)).toThrow(/expired/i);
  });
});
