import { describe, expect, it } from "vitest";
import { macToolPath } from "./mac-path";

function fakeFs(dirs: string[], nvmVersions: string[] = []) {
  return {
    exists: (path: string) => dirs.includes(path),
    list: (path: string) => (path === "/Users/me/.nvm/versions/node" ? nvmVersions : []),
  };
}

describe("macToolPath (ADR-007)", () => {
  it("adds Homebrew, Volta and the newest nvm Node that exist, after the current PATH", () => {
    const fs = fakeFs(["/opt/homebrew/bin", "/Users/me/.volta/bin", "/Users/me/.nvm/versions/node/v22.11.0/bin"], ["v20.18.1", "v22.11.0", "v9.0.0", "notes"]);
    expect(macToolPath("/usr/bin:/bin", "/Users/me", fs)).toBe("/usr/bin:/bin:/opt/homebrew/bin:/Users/me/.volta/bin:/Users/me/.nvm/versions/node/v22.11.0/bin");
  });

  it("doesn't repeat entries already on PATH or add missing folders", () => {
    const fs = fakeFs(["/usr/local/bin"]);
    expect(macToolPath("/usr/local/bin:/usr/bin", "/Users/me", fs)).toBe("/usr/local/bin:/usr/bin");
    expect(macToolPath(undefined, "/Users/me", fakeFs([]))).toBe("");
  });
});
