# Test Plan

## Critical behavior to protect

1. No duplicate interventions.
2. A resolved intervention never reappears unless a new signal exists.
3. A snoozed intervention is not delivered before its snooze time.
4. Invalid LLM output never mutates domain state.
5. A provider failure does not delete good local data.
6. Revoked OAuth credentials produce a recoverable integration state.
7. Desktop reconnects after temporary API/SSE failure.
8. Clicking Done/Snooze is idempotent.

## Demo fixtures

Provide fixed fixtures for:
- urgent approval waiting
- low-value newsletter
- meeting in 15 minutes
- meeting next week
- reply already sent
- duplicate provider message
- snoozed intervention

## Success metric for Phase 1

The system should produce a clearly useful top-3 list from the demo dataset, with no duplicate or already-resolved interventions.
