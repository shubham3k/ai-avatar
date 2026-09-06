# Worker

Dedicated Node process for Phase 1 scheduled work.

Suggested jobs:

```text
sync-gmail
sync-calendar
process-signals
evaluate-signals
reawaken-snoozed-interventions
```

Use node-cron in Phase 1. Move to Redis/BullMQ in Phase 2 when jobs need durability, retries, concurrency controls, and horizontal execution.
