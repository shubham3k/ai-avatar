# Security and Privacy - Phase 1

## OAuth

Use server-side Google OAuth because the app needs offline access. Request read-only scopes in Phase 1. Store refresh tokens encrypted at rest. Google documents server-side OAuth and refresh-token storage for offline access. 

Recommended scopes for Phase 1:
- Gmail read-only
- Calendar read-only

Do not request write scopes until Phase 3 actions are implemented.

## Secrets

- `.env` is local only.
- `.env.example` contains names only.
- Never put secrets in Next.js client bundles.
- Never pass Google refresh tokens to the desktop renderer.

## Token encryption

Use AES-256-GCM with a server-side encryption key. Store ciphertext, IV, and authentication tag separately or in a versioned envelope.

## Logging

Do not log:
- OAuth tokens
- email bodies
- raw calendar descriptions
- full LLM context

Do log:
- user id
- provider
- sync operation
- object id
- status
- duration
- error class

## Browser/Desktop security

- Use Electron preload with `contextIsolation: true`.
- Do not expose Node APIs to renderer code.
- Prefer a narrow IPC surface.
- Keep remote content out of the desktop renderer.
- Authenticate desktop API calls with a short-lived device/session credential, not the user's Google token.

## Phase 1 posture

This is a personal/local prototype. Treat production deployment as a separate security milestone before onboarding other users.
