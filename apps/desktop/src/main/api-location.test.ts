import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveApiRoot } from "./api-location.js";

describe("resolveApiRoot", () => {
  it("packaged: resolves to <resourcesPath>/api", () => {
    const root = resolveApiRoot({ isPackaged: true, resourcesPath: "C:\\Program Files\\App\\resources" });
    expect(root).toBe(join("C:\\Program Files\\App\\resources", "api"));
  });

  it("dev/unpackaged: resolves to apps/api, this file's sibling under apps/", () => {
    const root = resolveApiRoot({ isPackaged: false, resourcesPath: "irrelevant" });
    expect(root.replace(/\\/g, "/")).toMatch(/\/apps\/api$/);
  });
});
