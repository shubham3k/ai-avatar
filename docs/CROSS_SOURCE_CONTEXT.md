# Cross-Source Context (Phase 2.6A)

Deterministic correlation only — **not AI**. No LLM, no embeddings, no
semantic/fuzzy matching, no vector search. Same input always produces the
same output. This is the first step toward feeding a future AI
prioritization layer (Phase 2.6+) structured, low-noise signal instead of
raw records — it does **not** create signals or interventions itself.

## What this is

Given the user's recently stored Gmail emails (Phase 2.2B) and upcoming
Calendar events (Phase 2.4B), find *obvious* relationships between them —
e.g. "this email is from someone attending that meeting." Nothing is
persisted; the result is computed fresh on every request.

```
stored Email rows          stored CalendarEvent rows
        │                            │
        └──────────► buildCrossSourceContext() ◄──────────┘
                         (pure, deterministic)
                              │
                    CrossSourceContext[]
                     (in-memory only)
```

## Endpoint

`GET /api/v1/context/cross-source` — read-only. Creates no signals, no
interventions, triggers no Gmail/Calendar sync.

```json
{
  "contexts": [
    {
      "emailId": "...",
      "calendarEventId": "...",
      "relationship": {
        "type": "attendee_match",
        "strength": "strong",
        "reason": "Email sender john@acme.com is an attendee of the upcoming calendar event.",
        "matchedTerms": ["proposal"]
      },
      "temporalContext": {
        "emailReceivedAt": "2026-09-14T11:00:00.000Z",
        "eventStartAt": "2026-09-15T10:00:00.000Z",
        "hoursBetween": 23
      }
    }
  ]
}
```

`contexts: []` is a completely normal, expected response when nothing
correlates — most of the time, nothing will. Forcing a match would be worse
than reporting none.

**Try it locally** (after syncing Gmail and Calendar):
```bash
curl "http://localhost:4000/api/v1/context/cross-source"
```

## Correlation rules

Two rules, both deterministic and testable in isolation
(`apps/api/src/domain/context/cross-source-context.rules.ts`):

### Rule A — sender ↔ attendee match (`strong`)

The email's `fromEmail` exactly matches (case-insensitive) one of the
calendar event's `attendeeEmails`. This is the strongest evidence available
and is always classified `strong`.

### Rule B — topic overlap (`possible`)

Meaningful terms from `email.subject + email.snippet` overlap with terms
from the calendar event's title. "Meaningful" means: lowercased, punctuation
stripped, at least 4 characters, and not in a fixed stop-word list that
explicitly includes generic words like `meeting`, `project`, `update`,
`call`, `sync`, `review`, `today`, `tomorrow` — the words the phase brief
specifically warned would create false positives. A single overlapping
meaningful term is enough; simple set intersection, no scoring, no partial/
fuzzy string matching.

If **both** rules match the same email/event pair, the result is still just
`strong` (attendee match) — there's no third "stronger than strong" tier —
but the overlapping terms are attached as bonus `matchedTerms` context.

### What does NOT create a relationship

- Temporal proximity alone (email received today, meeting tomorrow) — this
  is attached as `temporalContext` only once a relationship already exists
  on other evidence, never used to manufacture one.
- Generic/stop words alone.
- A missing sender, missing attendees, missing subject, or missing event
  title — the builder returns no relationship for that pair rather than
  guessing.

## Data limits

Both bounded and windowed — never a full mailbox/calendar scan:

| | Fetch cap | Time window |
|---|---|---|
| Emails | 25 most recent (existing `listRecent`) | last 14 days |
| Calendar events | 25 soonest upcoming (existing `listUpcoming`) | next 7 days |

Both repository calls already existed from Phase 2.2B/2.4B — nothing new was
added to either repository; the service just calls them and filters.
Comparison is a bounded in-memory O(emails × events) loop (≤625 pairs) — no
search index, cache, or background job.

## Privacy

The response never includes email body/full snippet text beyond what's
needed to explain a match, never includes the calendar event's
`description`, and never includes OAuth tokens. Nothing is logged.

## Known limitations (intentional)

- Token overlap doesn't distinguish topical words from person/company names
  that happen to be ≥4 characters (e.g. "Sarah" would pass the length/
  stop-word filter) — a dedicated name-exclusion list was deliberately not
  built here, to avoid the "complex fuzzy-matching engine" the phase brief
  explicitly said not to build. Revisit only if false positives from names
  turn out to matter in practice.
- No stemming/lemmatization ("proposal" and "proposals" are different
  tokens) — deliberately simple.
- Independent per email/event pair — no attempt to reason about a whole
  thread or a sequence of related meetings.
- Purely reactive to what's already synced; does not trigger Gmail/Calendar
  sync itself.

## Code

| Concern | File |
|---|---|
| Types | `apps/api/src/domain/context/cross-source-context.types.ts` |
| Rules (stop words, windows, token matching) | `apps/api/src/domain/context/cross-source-context.rules.ts` |
| Builder (pure function) | `apps/api/src/domain/context/cross-source-context.builder.ts` |
| Service (loads data, applies windows, calls builder) | `apps/api/src/domain/cross-source-context.service.ts` |
| HTTP route | `apps/api/src/routes/context.ts` |
| Shared contract | `packages/shared/src/contracts/api.schema.ts` (`crossSourceContextResponseSchema`) |
