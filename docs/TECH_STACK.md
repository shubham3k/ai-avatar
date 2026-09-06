# Technology Stack

| Layer | Technology | Phase | Why |
|---|---|---:|---|
| Web | Next.js + TypeScript | 1+ | Fast UI development and mature React ecosystem |
| UI | Tailwind + shadcn/ui | 1+ | Fast, consistent product UI |
| API | Fastify + TypeScript | 1+ | Small, fast HTTP layer with low ceremony |
| ORM | Prisma | 1+ | Familiar typed DB workflow and migrations |
| DB | PostgreSQL | 1+ | Strong relational model for domain state |
| Worker | Node.js + node-cron | 1 | Simplest scheduled execution |
| Queue | Redis + BullMQ | 2+ | Add when job durability/concurrency matters |
| Realtime | SSE | 1 | One-way backend-to-client delivery is enough |
| Desktop | Electron + React | 1+ | Easiest path to transparent always-on-top overlay |
| Animation | PNG + CSS first; Rive later | 1/3 | Keep Phase 1 simple |
| LLM | OpenAI Responses API | 1+ | Server-side structured reasoning |
| Validation | Zod | 1+ | Runtime validation at API/provider/LLM boundaries |
| Google | googleapis | 1+ | Official Gmail/Calendar API client |
| Package manager | pnpm workspaces | 1+ | Simple monorepo without extra build orchestration |
| Testing | Vitest + Playwright | 1+ | Unit and browser E2E coverage |

## Deliberately not using in Phase 1

- Kubernetes
- Kafka/NATS
- GraphQL
- LangGraph
- vector database
- Redis
- microservices
- Terraform
- Rive
- Slack/CRM integrations

These may be useful later, but they do not help prove the core product loop.
