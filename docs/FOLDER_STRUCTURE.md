# Recommended Full Project Structure

```text
ai-executive-agent/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .cursor/
│   └── rules/
│       ├── 00-project.mdc
│       ├── 01-frontend.mdc
│       ├── 02-backend.mdc
│       ├── 03-desktop.mdc
│       └── 04-ai.mdc
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── package.json
│   ├── api/
│   │   ├── prisma/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── http/
│   │   │   ├── domain/
│   │   │   ├── providers/
│   │   │   ├── agent/
│   │   │   └── db/
│   │   └── package.json
│   ├── worker/
│   │   ├── src/
│   │   │   ├── jobs/
│   │   │   ├── sync/
│   │   │   └── scheduler/
│   │   └── package.json
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   ├── preload/
│       │   └── renderer/
│       └── package.json
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── contracts/
│       │   ├── schemas/
│       │   └── types/
│       └── package.json
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── TECH_STACK.md
│   ├── DATA_MODEL.md
│   ├── EVENT_MODEL.md
│   ├── AGENT_SPEC.md
│   ├── SECURITY.md
│   ├── PHASE_PLAN.md
│   ├── BUILD_GUIDE.md
│   ├── TEST_PLAN.md
│   ├── FOLDER_STRUCTURE.md
│   └── decisions/
└── infra/
```

The structure is intentionally a monorepo but not a microservice architecture. `apps/api` and `apps/worker` are separate processes because their runtime responsibilities differ, while they can still share domain code and the same database.
