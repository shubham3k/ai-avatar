import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureEncryptionKey,
  generateEncryptionKey,
  loadUserConfig,
  saveUserConfig,
  type SafeStorageLike,
} from "./app-config.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-agent-desktop-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fake OS-keychain: reversible, deterministic, no real OS dependency — enough to test the plumbing. */
function makeFakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`ENC(${plainText})`, "utf-8"),
    decryptString: (encrypted) => {
      const text = encrypted.toString("utf-8");
      const match = /^ENC\((.*)\)$/.exec(text);
      if (!match) throw new Error("Cannot decrypt: not encrypted by this fake keychain");
      return match[1]!;
    },
  };
}

describe("app-config", () => {
  it("returns an empty config when no file exists yet, reporting secure-storage availability", () => {
    const safeStorage = makeFakeSafeStorage(true);
    expect(loadUserConfig(dir, safeStorage)).toEqual({ secureStorageAvailable: true });
  });

  it("persists and reloads a saved Groq key, encrypted via safeStorage", () => {
    const safeStorage = makeFakeSafeStorage(true);
    saveUserConfig(dir, safeStorage, { groqApiKey: "gsk_test_123" });

    expect(loadUserConfig(dir, safeStorage)).toEqual({
      groqApiKey: "gsk_test_123",
      secureStorageAvailable: true,
    });
  });

  it("never writes the Groq key in plain text when secure storage is available", () => {
    const safeStorage = makeFakeSafeStorage(true);
    saveUserConfig(dir, safeStorage, { groqApiKey: "gsk_super_secret" });

    const raw = readFileSync(join(dir, "config.json"), "utf-8");
    expect(raw).not.toMatch(/gsk_super_secret/);
  });

  it("persists and reloads an auto-generated encryption key", () => {
    const safeStorage = makeFakeSafeStorage(true);
    const key = generateEncryptionKey();
    saveUserConfig(dir, safeStorage, { encryptionKey: key });

    expect(loadUserConfig(dir, safeStorage).encryptionKey).toBe(key);
  });

  it("persists and reloads Google OAuth client credentials, encrypted via safeStorage (Phase 4.7)", () => {
    const safeStorage = makeFakeSafeStorage(true);
    saveUserConfig(dir, safeStorage, {
      googleClientId: "client-id-123.apps.googleusercontent.com",
      googleClientSecret: "google-secret-abc",
    });

    expect(loadUserConfig(dir, safeStorage)).toEqual({
      googleClientId: "client-id-123.apps.googleusercontent.com",
      googleClientSecret: "google-secret-abc",
      secureStorageAvailable: true,
    });

    const raw = readFileSync(join(dir, "config.json"), "utf-8");
    expect(raw).not.toMatch(/google-secret-abc/);
  });

  it("merges a later save with an earlier one instead of overwriting the whole file", () => {
    const safeStorage = makeFakeSafeStorage(true);
    saveUserConfig(dir, safeStorage, { groqApiKey: "first" });
    const result = saveUserConfig(dir, safeStorage, { encryptionKey: "some-key" });

    expect(result).toEqual({
      groqApiKey: "first",
      encryptionKey: "some-key",
      secureStorageAvailable: true,
    });
    expect(loadUserConfig(dir, safeStorage)).toEqual({
      groqApiKey: "first",
      encryptionKey: "some-key",
      secureStorageAvailable: true,
    });
  });

  it("falls back to unencrypted (but still base64-wrapped) storage when the OS keychain is unavailable, and reports it", () => {
    const safeStorage = makeFakeSafeStorage(false);
    saveUserConfig(dir, safeStorage, { groqApiKey: "gsk_no_keychain" });

    const result = loadUserConfig(dir, safeStorage);
    expect(result.groqApiKey).toBe("gsk_no_keychain");
    expect(result.secureStorageAvailable).toBe(false);
  });

  it("returns an empty config for a corrupt/unreadable config file", () => {
    const safeStorage = makeFakeSafeStorage(true);
    saveUserConfig(dir, safeStorage, { groqApiKey: "x" });
    writeFileSync(join(dir, "config.json"), "{not valid json", "utf-8");

    expect(loadUserConfig(dir, safeStorage)).toEqual({ secureStorageAvailable: true });
  });

  it("migrates a Phase 4.3 plaintext (v1) config file without crashing", () => {
    const safeStorage = makeFakeSafeStorage(true);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ groqApiKey: "legacy_plain_key" }), "utf-8");

    expect(loadUserConfig(dir, safeStorage)).toEqual({
      groqApiKey: "legacy_plain_key",
      secureStorageAvailable: true,
    });
  });

  it("re-saving after loading a legacy file upgrades it to the encrypted v2 format", () => {
    const safeStorage = makeFakeSafeStorage(true);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ groqApiKey: "legacy_plain_key" }), "utf-8");

    saveUserConfig(dir, safeStorage, {});

    const raw = readFileSync(join(dir, "config.json"), "utf-8");
    expect(raw).not.toMatch(/legacy_plain_key/);
    expect(JSON.parse(raw).version).toBe(2);
    expect(loadUserConfig(dir, safeStorage).groqApiKey).toBe("legacy_plain_key");
  });

  it("treats a value the current OS keychain cannot decrypt as unset instead of throwing", () => {
    const writer = makeFakeSafeStorage(true);
    saveUserConfig(dir, writer, { groqApiKey: "written-on-another-machine" });

    const brokenReader: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: writer.encryptString,
      decryptString: () => {
        throw new Error("simulated: cannot decrypt, wrong OS user/machine");
      },
    };

    expect(loadUserConfig(dir, brokenReader)).toEqual({ secureStorageAvailable: true });
  });
});

describe("generateEncryptionKey", () => {
  it("generates a base64-encoded 32-byte key, matching apps/api/src/lib/crypto.ts's requirement", () => {
    const key = generateEncryptionKey();
    expect(Buffer.from(key, "base64")).toHaveLength(32);
  });

  it("generates a different key each time", () => {
    expect(generateEncryptionKey()).not.toBe(generateEncryptionKey());
  });
});

describe("ensureEncryptionKey", () => {
  it("generates and persists a key on first call", () => {
    const safeStorage = makeFakeSafeStorage(true);
    const result = ensureEncryptionKey(dir, safeStorage);

    expect(result.encryptionKey).toBeDefined();
    expect(Buffer.from(result.encryptionKey!, "base64")).toHaveLength(32);
  });

  it("is idempotent — returns the same key on a second call instead of generating a new one", () => {
    const safeStorage = makeFakeSafeStorage(true);
    const first = ensureEncryptionKey(dir, safeStorage);
    const second = ensureEncryptionKey(dir, safeStorage);

    expect(second.encryptionKey).toBe(first.encryptionKey);
  });
});
