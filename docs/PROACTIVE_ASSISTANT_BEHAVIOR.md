# Proactive Assistant Behavior (Phase 3.3)

**Verification phase, not a rewrite.** Phase 2.8A's existing
`assistant-decision.evaluator.ts` / `assistant-decision.rules.ts` already
implement deterministic, application-owned surfacing — this phase confirmed
(with new tests where a gap existed) that it satisfies every proactive
behavior rule Phase 3 asked for, and made no production-code changes beyond
Phase 3.2's daily-context input.

## The rule: silence is the default

> "The assistant should not show everything it knows. It should surface
> something only when it is useful."

Concretely, per situation, exactly one of three things happens — no
complex scoring, just the same deterministic surfacing rule from
Phase 2.8A:

| Situation | Behavior | Enforced by |
|---|---|---|
| `high` priority | Always surfaces | `isEligibleToSurface` |
| `medium` priority, relationship `strong` (attendee_match) | Surfaces | `isEligibleToSurface` |
| `medium` priority, relationship `possible` (topic_overlap) | Stays silent | `isEligibleToSurface` |
| `low` priority | Always stays silent | `isEligibleToSurface` |
| AI omitted the situation entirely | Stays silent | `evaluateAssistantDecision` (`aiResult` undefined → `skip`) |
| Already has *any* intervention (pending/snoozed/resolved/dismissed) for any signal in the situation | Reused, never re-created or re-surfaced as new | `evaluateAssistantDecision` (`existingInterventionId` → `reuse`) |
| Repeated `POST /assistant/evaluate` calls | Idempotent — same intervention every time, never mutated | reuse path never writes |

## Why "already completed" and "snoozed" correctly stay quiet

Two independent, already-existing mechanisms combine to make this work
without any new state:

1. **Orchestration never re-creates.** `assistant-evaluation.service.ts`
   checks `InterventionsRepository.findBySignalId` for *every* signal in the
   situation before deciding anything. If one exists — in *any* status,
   including `resolved` or `dismissed` — the situation is `reuse`d: nothing
   is written, and the existing row (whatever its current status) is
   returned as-is.
2. **The desktop only ever polls "inbox" state.** `listInbox` (used by
   `GET /api/v1/interventions`, which the desktop polls) only returns
   `status: "pending"` or `status: "snoozed"` rows whose snooze has expired
   — a `resolved` or `dismissed` row, or one still snoozed, simply never
   appears again, regardless of how many times `/assistant/evaluate` reruns.

Neither of these needed to change for Phase 3.3 — they already did exactly
what the phase brief asked for.

## New test coverage added this phase

`tests/assistant-evaluate.api.test.ts` already covered high/medium-strong/
low/omitted/snoozed/done/multi-situation-independence before this phase.
Two gaps were closed:

- **"does not mutate the stored intervention when the AI returns a
  different priority on re-evaluation"** — locks down that the reuse path
  never rewrites an existing intervention's `priority`/`message`, even when
  a later AI call reports a different opinion for the same situation. This
  wasn't explicitly tested before, even though the code already behaved
  this way.
- **"stays idempotent across three repeated evaluations"** — extends the
  existing two-call reuse test to three, confirming no drift over repeated
  calls.

## Desktop — no changes needed

`use-intervention-polling.ts` already surfaces only `items[0]` (the single
highest-priority pending/snoozed intervention the API returns) — never a
list of everything the assistant knows about. This already matches "silence
is a valid decision" and "don't constantly interrupt the user"; nothing in
the desktop needed to change for this phase.

## Explicitly not built (per the phase brief)

No notification-scoring system, no new intervention states, no new
"urgency" computation beyond what Phase 2.7's AI already reasons about
(now with Phase 3.2's added daily-context timing information). The
deterministic surfacing rule is intentionally the same three-tier
high/medium-strong/low rule from Phase 2.8A.
