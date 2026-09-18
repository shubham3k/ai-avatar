# Secrets & Config Storage (Phase 4.4)

Upgrades Phase 4.3's interim plain-JSON settings storage to Electron's
`safeStorage` API — Windows DPAPI, macOS Keychain, or Linux libsecret,
depending on platform — and removes the last manual setup step for the
desktop app: generating `ENCRYPTION_KEY` by hand.

## What's encrypted now

`apps/desktop/src/main/app-config.ts` stores two secrets, both
OS-keychain-encrypted via `safeStorage.encryptString`/`decryptString`,
base64-wrapped for JSON storage in `config.json` (Electron's `userData`
directory):

- **Groq API key** — unchanged in purpose from Phase 4.3, now actually
  encrypted instead of plain text.
- **`ENCRYPTION_KEY`** — new this phase. This is the AES-256-GCM key
  `apps/api/src/lib/crypto.ts` uses to encrypt Google OAuth refresh tokens
  at rest. Previously this required a manual
  `openssl rand -base64 32` + hand-editing `.env` — a real blocker for
  "install and it just works." Now auto-generated on first launch if
  nothing else provides one.

## `safeStorage` is injected, not imported directly

`app-config.ts` takes a `SafeStorageLike` interface as a parameter rather
than importing `safeStorage` from `"electron"` itself — the real one is
only passed in from `index.ts`. This keeps the module unit-testable
without a running Electron instance; tests use a small fake (reversible
`ENC(...)` wrapping) that exercises the same encode/decode/migration logic
the real `safeStorage` would.

## `ENCRYPTION_KEY` precedence — deliberately different from the Groq key's

Getting this wrong would silently make previously-encrypted Google refresh
tokens undecryptable, so the order is explicit and tested:

1. **Already in the encrypted store** (from a previous launch) → use it.
   Never regenerated once it exists.
2. **Present in `.env`** (a developer's own value, still the normal path
   for `apps/api` run standalone via `pnpm dev`, outside Electron) → use
   it, and persist it into the store so the app is self-sufficient even
   without `.env` present on a later run (e.g. once packaged, with no
   `.env` file at all).
3. **Neither** → generate a fresh random 32-byte key
   (`generateEncryptionKey()`, base64-encoded — the exact format
   `crypto.ts` requires) and persist it.

The Groq key keeps Phase 4.3's simpler rule: a value saved through the
Settings UI always wins over `.env`, since that's an explicit "I'm telling
you to use this one" user action, not a your-existing-secrets-still-work
safety concern.

**Verified for real, not just asserted:** launched Electron twice against
the real dev database. First launch: `config.json` was created with
`"secure": true` and a genuinely-encrypted (not human-readable) value —
confirming `safeStorage.isEncryptionAvailable()` is actually true on this
Windows machine and real DPAPI encryption is in use, not just base64
obfuscation. Second launch: the file's content hash was byte-for-byte
identical to the first — confirming the key is not silently regenerated on
every startup. Both launches: the embedded API started successfully and
`GET /integrations/google/status` responded normally, confirming the
generated key round-trips correctly through `crypto.ts`'s own 32-byte
validation.

## Backward compatibility with Phase 4.3's plaintext file

`loadUserConfig` recognizes the old shape (no `"version"` field, plain
`groqApiKey` string) and reads it once; the next `saveUserConfig` call
upgrades the file to the new encrypted `"version": 2` format automatically.
No manual migration step, no data loss for anyone who saved a key during
Phase 4.3 testing.

## What happens if secure storage isn't available

Some Linux environments have no keyring available;
`safeStorage.isEncryptionAvailable()` returns `false`. Rather than refuse
to save or silently pretend it's encrypted, the app stores the value as
plain base64 (still functional) and the Settings screen shows an explicit
warning: *"This device has no OS-level secure storage available — the
Groq key is stored as plain text instead of encrypted."* Honest, not
silent.

## Tests

14 tests in `app-config.test.ts` (round-trip encryption for both secrets,
merge-on-save, legacy-file migration and re-save upgrade, decrypt-failure
handled as "unset" rather than a crash — e.g. a config file encrypted on a
different machine/OS-user — `secureStorageAvailable: false` fallback,
`generateEncryptionKey`'s output format, `ensureEncryptionKey`'s
idempotency). Plus 1 new `App.test.tsx` test for the Settings-screen
warning banner. Full desktop suite: **39/40** (1 pre-existing, unrelated
Phase 2.1 failure).

## Code

| Concern | File |
|---|---|
| Encrypted storage + key generation | `apps/desktop/src/main/app-config.ts` |
| Precedence logic, wiring into the embedded API's env | `apps/desktop/src/main/index.ts` |
| `secureStorageAvailable` exposed to the renderer | `apps/desktop/src/main/ipc/register-ipc.ts` |
| Warning banner | `apps/desktop/src/renderer/components/Settings.tsx` |
