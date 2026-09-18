# Gmail Actionable-Email Signals (Phase 2.3)

Deterministic detection only — **not AI**. No LLM, no embeddings, no model
call of any kind. Same input always produces the same output. This proves
"can we reliably spot obvious things that need attention" before Phase 2.6
adds AI prioritization on top.

## Flow

```
stored Email rows (Phase 2.2B)
        ↓
detectActionableEmail() — pure, deterministic rules
        ↓
actionable? → Signal (type: user_action_required, source: email → Email.id)
        ↓
Intervention (existing pipeline — same one the demo scenario uses)
        ↓
desktop overlay (existing polling, unchanged)
```

Detection is manually triggered — there is no cron/background job. The
intended local flow is: sync Gmail, then run detection.

```bash
curl -X POST "http://localhost:4000/api/v1/integrations/google/gmail/sync"
curl -X POST "http://localhost:4000/api/v1/integrations/google/gmail/detect-signals"
```

## Endpoint

`POST /api/v1/integrations/google/gmail/detect-signals?limit=10` (max 25)

1. Loads the user's most recent stored emails (`emails.repository.listRecent`).
2. Runs the deterministic detector against each one.
3. For actionable emails, finds-or-creates a `Signal`, then finds-or-creates
   an `Intervention` for that signal — both through the existing repositories
   used by the Phase 1 demo pipeline, not a new system.
4. Returns a summary only:
   ```json
   { "analyzed": 10, "actionable": 3, "signalsCreated": 2, "interventionsCreated": 2 }
   ```
   (`signalsCreated`/`interventionsCreated` are lower than `actionable` once
   signals already exist from a prior run — see Idempotency below.)

## What the detector looks at

Only fields already persisted in Phase 2.2B: `fromEmail`, `fromName`,
`subject`, `snippet`, `isRead`, `labels`, `receivedAt`. **No email body is
fetched or read** — Gmail sync still only pulls metadata, unchanged from
Phase 2.2A/B.

### Gate conditions (all must pass before rules are checked)

- has a sender (`fromEmail` non-empty)
- unread (`isRead === false`)
- sender isn't excluded (see below)
- not excluded by Gmail labels (see below)
- received within the last **14 days**

### Exclusions

- **Sender**: local-part (before `@`) contains any of `noreply`, `no-reply`,
  `donotreply`, `do-not-reply`, `notification`, `newsletter`, `marketing`,
  `mailer-daemon`, `bounce`, `digest`.
- **Gmail labels**: `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`,
  `CATEGORY_UPDATES`, `CATEGORY_FORUMS`, `SPAM`, `TRASH`.

### Rules (checked against `subject + " " + snippet`, case-insensitive)

**HIGH confidence** — explicit response/confirmation/waiting language:
`waiting for your response`, `waiting for a response`, `waiting to hear from
you`, `please confirm`, `please respond`, `need your approval`, `need your
feedback`, `need your input`, `need your response`, `need your confirmation`,
`need your sign off` / `signoff`.

**MEDIUM confidence** — softer request language:
`can you`, `could you`, `can we`, `would you`, `let me know`, `following up`,
`when can you`, `are you available`.

A HIGH match always wins over a MEDIUM match on the same email. Keyword
presence alone is never sufficient — `"please"` on its own does not match
anything; only the specific phrases above do.

## Priority mapping

- HIGH confidence → intervention `priority: "high"`
- MEDIUM confidence → intervention `priority: "medium"`

No scoring, weighting, or ranking beyond this — that's Phase 2.6's job.

## Idempotency

- `Signal` uniqueness: `(userId, type, sourceType, sourceId)` — already
  enforced by the existing schema (`@@unique` on `Signal`). Re-running
  detection against the same email finds the existing signal instead of
  creating a new one.
- `Intervention` uniqueness: one per `signalId` (`@@unique([signalId])` on
  `Intervention`, already existing). No duplicate interventions.
- Net effect: running `/detect-signals` repeatedly against unchanged stored
  emails is a no-op after the first run (`signalsCreated`/`interventionsCreated`
  drop to 0).

## Code

| Concern | File |
|---|---|
| Rules (phrases/exclusions) | `apps/api/src/domain/signals/email/actionable-email.rules.ts` |
| Detector (pure function) | `apps/api/src/domain/signals/email/actionable-email.detector.ts` |
| Types | `apps/api/src/domain/signals/email/actionable-email.types.ts` |
| Orchestration (Email → Signal → Intervention) | `apps/api/src/domain/gmail-signal-detection.service.ts` |
| HTTP route | `apps/api/src/routes/google-gmail.ts` (`POST /detect-signals`) |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`gmailSignalDetectionResponseSchema`) |

## Current limitations (intentional)

- Deterministic keyword rules only — no NLP/AI, will miss paraphrased or
  differently-worded requests, and can still false-positive on an email that
  happens to contain one of the phrases without being a real request (e.g. a
  quoted reply chain containing "can you..."). This is accepted for Phase 2.3.
- Rules operate on subject + snippet only, not the full email body — a
  request buried past Gmail's snippet cutoff won't be seen. Expanding to
  full-body fetching was intentionally not done in this phase; it would
  change the Gmail API scope of work already established in 2.2A and needs
  its own decision, not an automatic expansion here.
- No re-evaluation: once a signal exists for an email, it's never
  re-detected/re-scored even if the email changes (e.g. later marked read is
  irrelevant since the signal already exists).
- No Calendar context, no AI ranking, no automatic detection trigger — see
  `docs/PHASE_PLAN.md` for what's next.
