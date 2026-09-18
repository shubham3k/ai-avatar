import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("token encryption", () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  it("round-trips a secret through encrypt/decrypt", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const plainText = "1//refresh-token-super-secret";

    const encrypted = encryptSecret(plainText);

    expect(encrypted).not.toContain(plainText);
    expect(decryptSecret(encrypted)).toBe(plainText);
  });

  it("produces different ciphertext for the same plaintext (random IV)", async () => {
    const { encryptSecret } = await import("./crypto.js");
    const a = encryptSecret("same-secret");
    const b = encryptSecret("same-secret");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const encrypted = encryptSecret("tamper-me");
    const buffer = Buffer.from(encrypted, "base64");
    buffer[buffer.length - 1] = (buffer[buffer.length - 1] ?? 0) ^ 0xff;
    const tampered = buffer.toString("base64");

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws a clear error when ENCRYPTION_KEY is missing", async () => {
    vi.doMock("../config/env.js", () => ({ env: { ENCRYPTION_KEY: undefined } }));
    const { encryptSecret } = await import("./crypto.js");
    expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY is not configured/);
    vi.doUnmock("../config/env.js");
  });
});
