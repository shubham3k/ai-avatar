# ADR-002: No Multi-Agent System in Phase 1

## Decision

Use one reasoning service with deterministic signal rules and typed outputs.

## Rationale

The first risk is not agent coordination. It is whether the system can reliably identify useful interventions. Multiple agents would increase latency, token cost, state complexity, testing surface, and debugging difficulty before that core behavior is validated.

A multi-agent approach can be introduced in Phase 3 if distinct responsibilities and failure isolation justify it.
