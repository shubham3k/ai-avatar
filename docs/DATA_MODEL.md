# Data Model - Phase 1

## Core entities

### User

- id
- email
- displayName
- timezone
- createdAt
- updatedAt

### Integration

- id
- userId
- provider (`google`)
- status
- accessTokenEncrypted (optional/short-lived)
- refreshTokenEncrypted
- expiresAt
- scopes
- createdAt
- updatedAt

### Email

- id
- userId
- providerMessageId (unique per provider)
- threadId
- fromEmail
- fromName
- toEmails
- subject
- snippet
- bodyText (Phase 1 can store only what is needed; do not over-collect — Gmail
  sync (Phase 2.2B) intentionally leaves this null, metadata/snippet only)
- receivedAt
- isRead (derived from the absence of Gmail's `UNREAD` label)
- labels (raw Gmail label IDs, e.g. `INBOX`, `UNREAD`)
- sourceUrl
- rawUpdatedAt (set to sync time; Gmail messages are otherwise immutable)

### CalendarEvent

- id
- userId
- providerEventId
- calendarId
- title
- description
- startAt
- endAt
- organizerEmail
- attendeeEmails
- sourceUrl
- rawUpdatedAt

### Signal

Represents a deterministic candidate for attention.

- id
- userId
- type (`reply_needed`, `approval_needed`, `deadline`, `upcoming_meeting`, `follow_up`)
- sourceType
- sourceId
- title
- summary
- dueAt (nullable)
- importanceHints (JSON)
- status
- createdAt

### Intervention

- id
- userId
- signalId
- status (`pending`, `snoozed`, `resolved`, `dismissed`)
- priority (`low`, `medium`, `high`, `critical`)
- title
- message
- reason
- actionType
- actionPayload
- snoozedUntil
- createdAt
- resolvedAt
- lastDeliveredAt

### AgentRun

- id
- userId
- triggerType
- inputSummary
- model
- outputJson
- status
- errorCode
- durationMs
- createdAt

## Required indexes

- Email: `(userId, receivedAt desc)`
- Email: `(userId, threadId)`
- CalendarEvent: `(userId, startAt)`
- Signal: `(userId, status, dueAt)`
- Intervention: `(userId, status, priority)`
- Intervention: `(userId, snoozedUntil)`

## Source of truth

PostgreSQL is the source of truth for internal state. Provider APIs remain the source of truth for external objects. Every provider object stored locally must retain its provider identifier.
