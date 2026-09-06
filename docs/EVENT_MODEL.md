# Event Model

Phase 1 uses application events in-process rather than a broker.

## Events

```text
provider.sync.started
provider.email.upserted
provider.calendar_event.upserted
signal.created
intervention.created
intervention.delivered
intervention.resolved
intervention.snoozed
intervention.reawakened
```

## Intervention event contract

```json
{
  "type": "intervention.created",
  "version": 1,
  "interventionId": "int_123",
  "userId": "usr_123",
  "priority": "high",
  "title": "Feedback needed",
  "message": "The design team is waiting for your feedback.",
  "action": {
    "type": "OPEN_SOURCE",
    "sourceType": "email",
    "sourceId": "email_123"
  },
  "createdAt": "2026-08-18T12:00:00Z"
}
```

## Delivery

The API exposes an authenticated SSE endpoint:

`GET /api/v1/events/stream`

The desktop app reconnects automatically with exponential backoff. SSE is sufficient because the client only needs server-to-client notifications. User actions use normal HTTPS API calls.

## Idempotency

An intervention should not be duplicated for the same user/source/signal unless the previous intervention has been resolved and a genuinely new signal is created.
