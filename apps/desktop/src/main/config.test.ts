import { describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

const { loadConfig } = await import("./config");

describe("loadConfig", () => {
  it("defaults syncIntervalMinutes to 5 when unset", () => {
    expect(loadConfig({}).syncIntervalMinutes).toBe(5);
  });

  it("accepts a value within the 5-30 range", () => {
    expect(loadConfig({ DESKTOP_SYNC_INTERVAL_MINUTES: "8" }).syncIntervalMinutes).toBe(8);
  });

  it("falls back to the default when the value is out of range", () => {
    expect(loadConfig({ DESKTOP_SYNC_INTERVAL_MINUTES: "1" }).syncIntervalMinutes).toBe(5);
    expect(loadConfig({ DESKTOP_SYNC_INTERVAL_MINUTES: "60" }).syncIntervalMinutes).toBe(5);
  });

  it("falls back to the default when the value isn't a number", () => {
    expect(loadConfig({ DESKTOP_SYNC_INTERVAL_MINUTES: "soon" }).syncIntervalMinutes).toBe(5);
  });

  it("apiUrl stays null unless DESKTOP_API_URL is set", () => {
    expect(loadConfig({}).apiUrl).toBeNull();
    expect(loadConfig({ DESKTOP_API_URL: "http://localhost:9999" }).apiUrl).toBe(
      "http://localhost:9999",
    );
  });
});
