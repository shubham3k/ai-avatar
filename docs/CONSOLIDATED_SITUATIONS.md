# Consolidated Situations (Phase 2.6B)

Deterministic grouping only — **not AI**. No LLM, no scoring model. Sits one
layer above Phase 2.6A's cross-source context: given the signals Phase 2.3
(Gmail) and Phase 2.5 (Calendar) already created, and the relationships
Phase 2.6A already found, recognize when an email signal and a calendar
signal represent *the same real-world situation* — so a future AI/prioritization
layer sees one thing to reason about instead of two disconnected ones.

This phase does **not** create, modify, or delete any `Signal` or
`Intervention` row. It's a read-only view computed fresh on every request.

## Flow

```
open Signal rows (Phase 2.3 + 2.5, unchanged)
                │
                ▼
   CrossSourceContext[] (Phase 2.6A, unchanged, reused as-is)
                │
                ▼
   evaluateConsolidatedSituations() — pure, deterministic
                │
                ▼
        ConsolidatedSituation[]  (in-memory only)
```

## Endpoint

`GET /api/v1/context/situations` — read-only.

```json
{
  "situations": [
    {
      "id": "signal_abc:signal_def",
      "signalIds": ["signal_abc", "signal_def"],
      "primarySignalId": "signal_def",
      "emailIds": ["email_1"],
      "calendarEventIds": ["event_1"],
      "relationship": { "type": "attendee_match", "strength": "strong" }
    }
  ]
}
```

`situations: []` is the normal, expected response whenever no open email
signal and open calendar signal are both linked by an existing cross-source
relationship — which is most of the time.

## Grouping rule

A situation is formed **only** when, for a given Phase 2.6A relationship
between an email and a calendar event, **both**:
- an open `Signal` with `sourceType: "email"`, `sourceId: <that email's id>`
  already exists, **and**
- an open `Signal` with `sourceType: "calendar_event"`,
  `sourceId: <that event's id>` already exists.

No new correlation logic is added — this phase entirely reuses Phase 2.6A's
`buildCrossSourceContext`/`cross-source-context.service.ts`, including its
conservatism (generic-word exclusion, no temporal-proximity-only matches).
Both `strong` (`attendee_match`) and `possible` (`topic_overlap`)
relationships can consolidate — Phase 2.6A already filtered out the
low-evidence cases before either relationship type is ever produced, so
there's no additional strength gate here. If a relationship exists but one
side has no corresponding open signal (e.g. the email wasn't flagged
actionable by Phase 2.3), no situation is formed for that pair.

## Primary signal selection

Fully deterministic, three ordered rules:

1. **Higher confidence wins.** Confidence ("high"/"medium") is read from the
   signal's existing `importanceHints.confidence` — the same field Phase 2.3
   and Phase 2.5 already write; no new data was added to `Signal` to support
   this.
2. **Concrete due date wins a tie.** If confidence is equal, the signal
   carrying a `dueAt` is preferred — in practice this is almost always the
   calendar signal, since Phase 2.3's email signals don't set one.
3. **Earlier `createdAt` wins the final tie.**

No numeric/weighted scoring at any step.

## What this deliberately does NOT do

- Does not merge signals on time proximity alone, shared generic words, or
  "same day" — all already excluded by reusing Phase 2.6A verbatim.
- Does not create a third relationship-strength tier when both attendee and
  topic evidence exist — the situation just reports `strong` (attendee
  match already implies the topic overlap is redundant confirmation).
- Does not group more than one email signal with more than one calendar
  signal into a single situation — one situation per correlated pair. If one
  email correlates with two different meetings, that's two situations.
- Does not persist anything — no new database table, no migration.
- Does not touch the `Signal`/`Intervention` tables in any way (no writes).

## Code

| Concern | File |
|---|---|
| Types | `apps/api/src/domain/context/consolidated-situation.types.ts` |
| Evaluator (pure function) | `apps/api/src/domain/context/consolidated-situation.evaluator.ts` |
| Service (loads signals + context, calls evaluator) | `apps/api/src/domain/consolidated-situations.service.ts` |
| HTTP route | `apps/api/src/routes/context.ts` (`GET /situations`) |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`consolidatedSituationsResponseSchema`) |
| New repository method (additive only) | `SignalsRepository.listOpen` in `apps/api/src/db/repositories/interventions.repository.ts` |
