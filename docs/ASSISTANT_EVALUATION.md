# Assistant Decision & Intervention Orchestration (Phase 2.8A)

Connects Phase 2.7's advisory AI prioritization to the **existing**
Intervention system and desktop overlay. This is the first phase where AI
output is allowed to result in a real `Intervention` row — but the AI still
never touches the database, never picks the action URL, and never decides
alone whether something surfaces. The application layer does.

## Flow

```
open Signal rows (Phase 2.3 + 2.5, unchanged)
                │
                ▼
   ConsolidatedSituation[] (Phase 2.6B, unchanged)
                │
                ▼
   AI prioritization (Phase 2.7, unchanged, advisory)
                │
                ▼
   assistant decision (this phase) — deterministic, application-controlled
                │
                ▼
   existing InterventionsRepository.create/findBySignalId (unchanged)
                │
                ▼
   existing desktop polling of GET /api/v1/interventions (unchanged)
```

## Endpoint

`POST /api/v1/assistant/evaluate` — the first assistant endpoint allowed to
create `Intervention` rows.

```json
{
  "results": [
    {
      "situationId": "signal_abc:signal_def",
      "eligible": true,
      "priority": "high",
      "interventionId": "int_123",
      "outcome": "created",
      "message": "The email requests the proposal before tomorrow's review."
    }
  ]
}
```

`outcome` is one of `"created" | "reused" | "skipped"`. It never sends
email, never modifies a calendar event, never creates a `Signal`, and never
performs any action beyond writing an `Intervention` row through the
existing repository.

## Surfacing rule (deterministic, application-owned)

Defined in `assistant-decision.rules.ts`:

- **`high` priority** → always eligible.
- **`medium` priority** → eligible **only** when the situation's Phase 2.6A
  relationship strength is `"strong"` (i.e. `attendee_match`). This reuses
  an already-computed deterministic fact instead of inventing a new score.
- **`low` priority`** → never proactively surfaced (avoids notification
  spam, per the phase brief).
- A situation the AI didn't return a result for is not surfaced.

## Intervention orchestration & idempotency

**Reuse-before-create, checked across *every* signal in the situation** (not
just the primary one) — because the deterministic Phase 2.3/2.5
`detect-signals` endpoints may have already created an intervention for
either side of the pair independently:

1. Look up `InterventionsRepository.findBySignalId` for each of the
   situation's `signalIds`.
2. If **any** exists → `outcome: "reused"`. The existing intervention (in
   whatever `status` it's in — pending, snoozed, or resolved) is returned
   as-is. **Nothing is written.** This is what makes done/snoozed/pending
   intervention state respected: none of those states are re-derived here,
   they're simply left alone by never attempting a second create.
3. If none exists **and** the situation is eligible (see above) →
   `interventions.create(...)` against the situation's `primarySignalId`
   (Phase 2.6B's own deterministic primary-signal selection), `outcome:
   "created"`.
4. If none exists and the situation is not eligible → `outcome: "skipped"`,
   nothing is written.

Repeated calls to this endpoint are therefore idempotent: the second call
for the same situation always finds the first call's intervention and
reuses it. No new deduplication mechanism was built — this is the same
find-or-create pattern `gmail-signal-detection.service.ts` and
`calendar-signal-detection.service.ts` already use.

## Message & action — never trusting the AI blindly

- **Message**: the AI's own `reason` field, truncated to 140 characters
  (`buildAssistantMessage`). No second LLM call rewrites it; the longer
  `recommendedAction` is stored separately on `Intervention.reason` for
  context, not shown as the headline message.
- **Action URL**: **always** the stored `Email.sourceUrl` or
  `CalendarEvent.sourceUrl` — selected by which one the primary signal
  belongs to. `PrioritizedSituationResult` (the AI's output type) has no
  URL-shaped field at all, so there is nothing for the AI to override even
  in principle; the trust boundary is enforced at the type level, not just
  by convention.
- `actionType: "open_source"` — the only action supported; the user
  explicitly opens the source via the desktop's "Open" button (added in
  Phase 2.8B — see below). No send-email, no calendar-write, no autonomous
  action of any kind.

## AI failure behavior

If Phase 2.7's prioritization fails (missing `GROQ_API_KEY`, provider
error, malformed output), this endpoint:
- creates **zero** interventions,
- fabricates **no** priority or message,
- leaves all existing deterministic `Signal`/`Intervention` rows untouched,
- returns the same failure mapping Phase 2.7 already uses (`400
  validation_error` for missing config, `502 upstream_error` for provider/
  malformed-output failures) — reusing the existing `AppError`/global error
  handler, not a new error shape.

## Desktop integration

New interventions created by this endpoint are ordinary `Intervention` rows,
so the desktop's existing polling of `GET /api/v1/interventions`
(`use-intervention-polling.ts`) picks them up automatically — same
transparent overlay, same character, same 15-second poll. Verified via a
real `curl` smoke test against the running API: `GET /interventions` returns
rows exactly as before, unaffected by this phase's code existing alongside
it.

**Correction (Phase 2.8B):** at the time this phase (2.8A) was written, the
desktop overlay had Done and Snooze buttons but **no way to trigger
`open_source`** — `actionPayload.sourceUrl` was computed and stored
correctly, but nothing in the renderer ever read it. Phase 2.8B added the
missing "Open" button and its IPC plumbing; see `HANDOFF.md`'s Phase 2.8B
addendum for details. This phase's `actionPayload` shape and trust boundary
(URL always from stored data) were already correct and needed no changes.

## Explicitly out of scope (per the phase brief)

No SSE, no WebSockets, no background workers, no Redis/queues, no new
signal type, no Gmail/Calendar write operations, no autonomous execution.
The user remains the one who clicks Done/Snooze/Open.

## Code

| Concern | File |
|---|---|
| Types | `apps/api/src/domain/assistant/assistant-decision.types.ts` |
| Surfacing/message rules | `apps/api/src/domain/assistant/assistant-decision.rules.ts` |
| Pure decision evaluator | `apps/api/src/domain/assistant/assistant-decision.evaluator.ts` |
| Orchestration (loads data, writes interventions) | `apps/api/src/domain/assistant-evaluation.service.ts` |
| HTTP route | `apps/api/src/routes/assistant.ts` (`POST /evaluate`) |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`assistantEvaluationResponseSchema`) |
