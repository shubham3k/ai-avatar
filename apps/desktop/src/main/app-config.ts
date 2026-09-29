import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/**
 * Phase 4.4: local settings persistence, now OS-keychain-backed via
 * Electron's `safeStorage` (Windows DPAPI / macOS Keychain / Linux
 * libsecret) instead of Phase 4.3's plain JSON. `safeStorage` is injected
 * (not imported directly from "electron") so this stays unit-testable
 * without a running Electron instance.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface UserConfig {
  groqApiKey?: string | undefined;
  /** AES key (base64) for encrypting Google OAuth tokens at rest — see apps/api/src/lib/crypto.ts. Auto-generated on first launch. */
  encryptionKey?: string | undefined;
  /**
   * Phase 4.7: Google OAuth client credentials. Deliberately never baked
   * into source/the packaged binary — unlike a "Desktop app"-type OAuth
   * client's secret (which Google's own model treats as not really
   * secret), a "Web application"-type client's secret is meant to stay
   * confidential, and committing one to git/a distributed .exe would leak
   * it permanently. Entered once through Settings, stored the same
   * encrypted way as groqApiKey.
   */
  googleClientId?: string | undefined;
  googleClientSecret?: string | undefined;
  /** ADR-006: primary AI provider key, stored encrypted like groqApiKey (Groq is now the optional fallback). */
  openaiApiKey?: string | undefined;
  /** ADR-006: OpenAI chat model chosen in Settings (default gpt-6-luna when unset). */
  openaiModel?: string | undefined;
  /** ADR-006 M4: global shortcut that opens Zara (default Ctrl+Shift+Space when unset). */
  chatHotkey?: string | undefined;
}

/** Every persisted field — each stored encrypted (or base64 when no OS keychain exists). */
const CONFIG_FIELDS = [
  "groqApiKey",
  "encryptionKey",
  "googleClientId",
  "googleClientSecret",
  "openaiApiKey",
  "openaiModel",
  "chatHotkey",
] as const satisfies readonly (keyof UserConfig)[];

export interface LoadedUserConfig extends UserConfig {
  /** False on platforms/environments where safeStorage has no OS keychain to use — the caller should warn the user their secrets are stored in plain text. */
  secureStorageAvailable: boolean;
}

type StoredFileV2 = {
  version: 2;
  secure: boolean;
} & { [K in (typeof CONFIG_FIELDS)[number]]?: string | undefined };

/** Phase 4.3's plaintext shape — read once, upgraded on next save. */
interface StoredFileV1 {
  groqApiKey?: string;
}

function configPath(userDataDir: string): string {
  return join(userDataDir, "config.json");
}

function encodeField(value: string, safeStorage: SafeStorageLike, secure: boolean): string {
  const buf = secure ? safeStorage.encryptString(value) : Buffer.from(value, "utf-8");
  return buf.toString("base64");
}

function decodeField(encoded: string, safeStorage: SafeStorageLike, secure: boolean): string {
  const buf = Buffer.from(encoded, "base64");
  return secure ? safeStorage.decryptString(buf) : buf.toString("utf-8");
}

export function loadUserConfig(userDataDir: string, safeStorage: SafeStorageLike): LoadedUserConfig {
  const secureStorageAvailable = safeStorage.isEncryptionAvailable();
  const path = configPath(userDataDir);
  if (!existsSync(path)) return { secureStorageAvailable };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { secureStorageAvailable };
  }
  if (!parsed || typeof parsed !== "object") return { secureStorageAvailable };

  const record = parsed as Record<string, unknown>;

  // Phase 4.3 legacy file: no "version" field, groqApiKey stored as plaintext.
  if (record.version !== 2) {
    const legacy = record as StoredFileV1;
    const groqApiKey =
      typeof legacy.groqApiKey === "string" && legacy.groqApiKey.length > 0
        ? legacy.groqApiKey
        : undefined;
    return { groqApiKey, secureStorageAvailable };
  }

  const file = record as unknown as StoredFileV2;
  try {
    const loaded: LoadedUserConfig = { secureStorageAvailable };
    for (const field of CONFIG_FIELDS) {
      const encoded = file[field];
      loaded[field] = typeof encoded === "string" ? decodeField(encoded, safeStorage, file.secure) : undefined;
    }
    return loaded;
  } catch {
    // Most likely: encrypted on a different machine/OS-user account, so
    // the OS keychain can't decrypt it. Treat as unset rather than crash —
    // the app will prompt to reconfigure through Settings.
    return { secureStorageAvailable };
  }
}

export function saveUserConfig(
  userDataDir: string,
  safeStorage: SafeStorageLike,
  patch: UserConfig,
): LoadedUserConfig {
  const existing = loadUserConfig(userDataDir, safeStorage);
  const secure = safeStorage.isEncryptionAvailable();
  const merged: UserConfig = {};
  const file: StoredFileV2 = { version: 2, secure };
  for (const field of CONFIG_FIELDS) {
    const value = patch[field] ?? existing[field];
    merged[field] = value;
    file[field] = value !== undefined ? encodeField(value, safeStorage, secure) : undefined;
  }
  writeFileSync(configPath(userDataDir), JSON.stringify(file, null, 2), "utf-8");

  return { ...merged, secureStorageAvailable: secure };
}

/** A base64-encoded 32-byte key — the exact format apps/api/src/lib/crypto.ts requires. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Ensures an encryption key exists, generating and persisting one on first
 * launch if not — removes the manual `openssl rand -base64 32` step for a
 * shipped app. Returns the config with `encryptionKey` always set.
 */
export function ensureEncryptionKey(
  userDataDir: string,
  safeStorage: SafeStorageLike,
): LoadedUserConfig {
  const existing = loadUserConfig(userDataDir, safeStorage);
  if (existing.encryptionKey) return existing;
  return saveUserConfig(userDataDir, safeStorage, { encryptionKey: generateEncryptionKey() });
}
