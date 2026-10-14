import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startFileLog } from "./file-log";

function fakeConsole() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("startFileLog (ADR-007 rev 1)", () => {
  it("copies console messages to main.log and still prints them", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "zara-log-")), "logs");
    const target = fakeConsole();
    const original = target.warn;
    const file = startFileLog(dir, target);
    target.warn("[hotkey] Could not register", "Cmd+Shift+Space");
    target.error("[crash]", new Error("boom"));
    const text = readFileSync(file, "utf-8");
    expect(text).toMatch(/app started/);
    expect(text).toMatch(/warn \[hotkey\] Could not register Cmd\+Shift\+Space/);
    expect(text).toMatch(/error \[crash\] Error: boom/);
    expect(original).toHaveBeenCalledWith("[hotkey] Could not register", "Cmd+Shift+Space");
  });

  it("starts a fresh log when the old one gets too big", () => {
    const dir = mkdtempSync(join(tmpdir(), "zara-log-"));
    writeFileSync(join(dir, "main.log"), "x".repeat(2_000_001));
    const target = fakeConsole();
    startFileLog(dir, target);
    target.log("after");
    expect(existsSync(join(dir, "main.old.log"))).toBe(true);
    expect(readFileSync(join(dir, "main.log"), "utf-8")).toMatch(/after/);
  });
});
