# ADR-004: Stateless Signed State for Google OAuth

## Decision

Bind the Google OAuth `connect` -> `callback` round trip to a user with a signed,
self-contained `state` parameter (HMAC-SHA256 over `{userId, nonce, exp}`) instead
of a server-side session store.

## Rationale

Phase 1 has no session/queue infrastructure (no Redis) and is single-user by
default. A signed state token gives CSRF protection and expiry (10 minutes)
without adding stateful infrastructure. It reuses `ENCRYPTION_KEY`, the same
secret already used to encrypt refresh tokens at rest, so no new secret is
introduced.

This can be replaced by a session-bound state (or dropped in favor of a signed
cookie) once Phase 2 introduces durable user sessions.
