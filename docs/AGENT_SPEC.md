# Agent Specification - Phase 1

## Important design rule

The agent is not autonomous. Its job is to rank candidate signals and produce a structured intervention proposal.

## Input

The model receives a compact context object, not the whole database.

```json
{
  "user": {
    "timezone": "Asia/Kolkata"
  },
  "candidate": {
    "type": "reply_needed",
    "summary": "Design team asked for approval.",
    "dueAt": "2026-08-19T11:00:00+05:30"
  },
  "relatedEmails": [],
  "relatedCalendarEvents": [],
  "openInterventions": [],
  "userPreferences": {
    "quietHours": null
  }
}
```

## Output schema

```json
{
  "decision": "intervene",
  "priority": "high",
  "title": "Feedback needed",
  "message": "The design team is waiting for your feedback. The launch is tomorrow.",
  "reason": "A time-sensitive approval is waiting on the user.",
  "actionType": "open_source",
  "confidence": 0.94
}
```

Allowed decisions:
- `intervene`
- `ignore`

Allowed priorities:
- `low`
- `medium`
- `high`
- `critical`

## Prompt policy

The prompt should instruct the model to:

- prioritize user actionability over information volume
- avoid interrupting for low-value items
- avoid inventing deadlines, relationships, or urgency
- use only supplied context
- return the exact schema
- keep the message under a practical UI limit

## Deterministic guardrails after the LLM

Reject/ignore the output when:
- confidence is below the configured threshold
- the source signal no longer exists
- the source has been resolved
- the same intervention was recently created
- quiet hours apply, unless the priority policy explicitly permits bypass

The LLM is not the source of truth for the source object or state.
