# Google OAuth (Phase 2.1 — Foundation)

This is the OAuth foundation only: connecting a Google account and storing an
encrypted refresh token. It does **not** read Gmail or Calendar data yet.

## What this provides

- `GET /api/v1/integrations/google/connect` — redirects the browser to Google's
  consent screen.
- `GET /api/v1/integrations/google/callback` — Google redirects here after
  consent; the API exchanges the code, stores the connection, and redirects to
  `${APP_BASE_URL}/integrations/google?status=connected|error`.
- `GET /api/v1/integrations/google/status` — `{ connected, provider, email, scopes }`.
  Never returns tokens.
- `POST /api/v1/integrations/google/disconnect` — marks the connection `disabled`.

The desktop overlay exposes a small "Connect Google" link (visible only when
there is no pending intervention) that opens `/connect` in the system browser.

## 1. Google Cloud project setup

1. Create (or reuse) a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Gmail API** and **Google Calendar API** (needed for the next
   phase; the scopes are already requested now so users are not re-prompted later).
3. Configure the **OAuth consent screen**:
   - User type: External (Testing mode is fine for local development).
   - Add your own Google account as a test user.
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/gmail.readonly`,
     `.../auth/calendar.readonly`.
4. Create an **OAuth Client ID** (type: Web application).
   - Authorized redirect URI: `http://localhost:4000/api/v1/integrations/google/callback`
     (must exactly match `GOOGLE_REDIRECT_URI`).

## 2. Environment variables

Set these in `.env` (repo root and/or `apps/api/.env` — both are read):

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/integrations/google/callback
ENCRYPTION_KEY=<base64 32-byte key>
```

Generate `ENCRYPTION_KEY` with:

```bash
openssl rand -base64 32
```

`ENCRYPTION_KEY` is required for any Google connection to be stored — it
encrypts the refresh/access tokens at rest with AES-256-GCM
(`apps/api/src/lib/crypto.ts`). It is intentionally the same key already
reserved in `.env.example`; no separate `GOOGLE_TOKEN_ENCRYPTION_KEY` was
introduced.

Never commit real values for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or
`ENCRYPTION_KEY`.

## 3. Connecting a Google account locally

1. Start Postgres and run migrations (`pnpm db:migrate`).
2. Start the API: `cd apps/api && pnpm dev`.
3. Visit `http://localhost:4000/api/v1/integrations/google/connect` in a
   browser (or click "Connect Google" in the desktop overlay).
4. Approve the consent screen. You'll be redirected to
   `${APP_BASE_URL}/integrations/google?status=connected` (this page doesn't
   exist yet in the web app — that's fine for Phase 2.1).
5. Confirm the connection:
   ```bash
   curl http://localhost:4000/api/v1/integrations/google/status
   ```

## 4. Disconnecting

```bash
curl -X POST http://localhost:4000/api/v1/integrations/google/disconnect
```

This sets the `Integration` row's `status` to `disabled`; it does not delete
history, and reconnecting via `/connect` restores it (`upsert` on
`(userId, provider)`).

## 4a. Gmail read-only access (Phase 2.2A)

`GET /api/v1/integrations/google/gmail/messages?limit=10` fetches recent
Gmail messages using the same stored connection — no separate OAuth flow.

- Scope reused: `gmail.readonly` (already requested during `/connect`, no
  re-consent needed).
- `limit` is optional (default 10), and rejected above 25 — this is a small,
  controlled read, not a mailbox sync. There is no persistence: nothing is
  written to the database by this endpoint — see 4b for persistence.
- Response:
  ```json
  { "messages": [
    { "id": "...", "threadId": "...", "subject": "...", "from": "...",
      "to": "...", "date": "...", "snippet": "...", "labels": ["INBOX"] }
  ] }
  ```
  Missing headers come back as `null` rather than throwing.

**Try it locally** (after connecting Google, see above):
```bash
curl "http://localhost:4000/api/v1/integrations/google/gmail/messages?limit=5"
```

**Common errors:**

| Status | Meaning |
|---|---|
| 404 `not_found` | No Google connection for this user — visit `/connect` first. |
| 400 `validation_error` | `limit` outside 1-25. |
| 403 `forbidden` | The stored refresh token is invalid/revoked, or Gmail access was denied — reconnect Google. |
| 502 `upstream_error` | Gmail API is temporarily unavailable, rate-limited, or the stored token could not be decrypted. |

The response never includes tokens; Gmail/OAuth errors are mapped to the safe
messages above rather than surfaced verbatim.

## 4b. Gmail persistence & sync (Phase 2.2B)

`POST /api/v1/integrations/google/gmail/sync?limit=10` fetches recent Gmail
messages (same limit rules as 4a) and upserts them into the local `Email`
table, keyed on `(userId, providerMessageId)`.

- **Idempotent**: running sync again with the same Gmail data updates the
  existing rows in place — it never creates duplicates.
- **Updates in place**: if a message's labels change (e.g. read/unread), the
  stored row is updated, not re-inserted.
- **What's stored**: subject, from/to, snippet, receivedAt, read state,
  labels, thread ID, a Gmail deep link. **Not** the email body — Phase 2.2A's
  metadata-only fetch is unchanged; nothing new is pulled from Gmail to
  support persistence.
- **receivedAt**: prefers the parsed `Date` header, falls back to Gmail's
  `internalDate` (always present) if that's missing/unparsable, and as a last
  resort uses the current time — persistence never fails over a timestamp.
- Response is a summary only, never email contents:
  ```json
  { "fetched": 10, "created": 7, "updated": 3 }
  ```

`GET /api/v1/integrations/google/gmail/stored-messages?limit=10` (max 50) is a
minimal read of what's already in the database — added only to make the
persistence layer testable/inspectable locally; it does not call Gmail.

**Try it locally:**
```bash
curl -X POST "http://localhost:4000/api/v1/integrations/google/gmail/sync?limit=10"
curl "http://localhost:4000/api/v1/integrations/google/gmail/stored-messages"
```

**Intentionally not implemented in this phase**: scheduled/background sync
(sync is manually triggered only), incremental/delta sync, email bodies,
signal detection, AI, Calendar, and any Gmail write operation.

## 5. How the pieces fit together

| Concern | File |
|---|---|
| Prisma model | `apps/api/prisma/schema.prisma` (`Integration`) |
| Token encryption | `apps/api/src/lib/crypto.ts` |
| CSRF-safe OAuth state | `apps/api/src/providers/google/oauth/state.ts` |
| Google OAuth client wrapper | `apps/api/src/providers/google/oauth/google-oauth.service.ts` |
| Connection persistence | `apps/api/src/db/repositories/integrations.repository.ts` |
| Business logic (connect/status/disconnect) | `apps/api/src/domain/google-connection.service.ts` |
| HTTP routes | `apps/api/src/routes/google-integration.ts` |
| Shared status contract | `packages/shared/src/contracts/api.schema.ts` (`googleConnectionStatusSchema`) |
| Gmail API client wrapper | `apps/api/src/providers/google/gmail/gmail.service.ts` |
| Gmail connection lookup + decrypt | `apps/api/src/domain/gmail-messages.service.ts` |
| Shared token-resolution used by both | `google-connection.service.ts`'s `getDecryptedRefreshToken()` |
| Email persistence | `apps/api/prisma/schema.prisma` (`Email`), `apps/api/src/db/repositories/emails.repository.ts` |
| Sync orchestration (Gmail → Email rows) | `apps/api/src/domain/gmail-sync.service.ts` |
| Gmail HTTP routes | `apps/api/src/routes/google-gmail.ts` |
| Shared Gmail contracts | `packages/shared/src/contracts/api.schema.ts` (`gmailMessageSchema`, `gmailMessagesResponseSchema`, `gmailSyncResponseSchema`, `storedEmailDtoSchema`) |

## 6. Security notes

- Read-only scopes only (`gmail.readonly`, `calendar.readonly`), per `AGENTS.md`.
- Refresh and access tokens are AES-256-GCM encrypted before being written to
  Postgres; the `/status` endpoint and all logs never include them.
- The OAuth `state` parameter is HMAC-signed and expires after 10 minutes,
  preventing forged callbacks (see `docs/decisions/ADR-004-google-oauth-state.md`).
- `@@unique([userId, provider])` on `Integration` means a user has at most one
  Google connection; connecting again updates it in place.

## 7. Explicitly out of scope

As of Phase 2.3: Google OAuth (2.1), read-only Gmail fetch (2.2A), Gmail
metadata persistence/sync (2.2B), and deterministic actionable-email signal
detection (2.3 — see [docs/GMAIL_SIGNALS.md](./GMAIL_SIGNALS.md)) are
implemented. Still not implemented: Calendar, email bodies, AI
prioritization, scheduled/background detection or sync, and multi-user
account management. See `docs/PHASE_PLAN.md` for what comes next.
