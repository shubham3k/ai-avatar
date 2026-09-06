# ADR-003: SSE for Phase 1 Desktop Delivery

## Decision

Use Server-Sent Events for server-to-desktop intervention delivery.

## Rationale

The server is the source of notifications and the client does not need a bidirectional realtime protocol. SSE is simpler to implement, debug, and reconnect. The desktop client sends actions through authenticated HTTP endpoints.
