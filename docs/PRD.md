# Product Requirements Document - AI Executive Agent

## 1. Product statement

A personal AI operations assistant that continuously evaluates work context and proactively tells the user what deserves attention, with an optional desktop character overlay for interruptions.

## 2. Primary user

A founder, operator, manager, or knowledge worker who receives information across email and calendar and frequently misses follow-ups, approvals, deadlines, or commitments.

## 3. Core problem

Users have too many independent signals. Email shows requests. Calendar shows commitments. Project tools show work. The user has to mentally correlate them. The product should perform that correlation and surface only the items that require attention.

## 4. Core loop

`Collect -> Normalize -> Detect -> Reason -> Prioritize -> Intervene -> Resolve/Snooze -> Learn`

## 5. Phase 1 scope

### Included
- Single-user local prototype.
- Google OAuth.
- Gmail read-only.
- Google Calendar read-only.
- Import recent Gmail messages and upcoming calendar events.
- Normalize data into internal entities.
- Detect candidate tasks/signals using deterministic rules.
- Ask an LLM to rank and explain candidates.
- Create intervention records.
- Web dashboard showing interventions.
- Electron desktop overlay.
- Character image with simple CSS entrance/exit animation.
- `Done` action.
- `Remind me later` action with a small set of preset snooze times.
- SSE from API to desktop app.
- Seed/demo mode with fake data so development does not depend on live accounts.

### Excluded
- Sending emails.
- Creating/modifying calendar events.
- Slack/CRM/Notion.
- Voice.
- Multi-user collaboration.
- Mobile apps.
- Fully autonomous agent loops.
- Complex long-term memory.

## 6. User stories

1. As a user, I connect Gmail and Calendar once and can see imported data.
2. As a user, I can see the top things that need my attention today.
3. As a user, I receive a desktop intervention when a high-priority item is detected.
4. As a user, I can mark an intervention done.
5. As a user, I can snooze an intervention.
6. As a developer, I can replay the same input data and obtain deterministic application behavior around the LLM decision.

## 7. Acceptance criteria

### Prototype is considered working when:
- A fresh local installation can start web, API, worker, and desktop apps.
- A user can authenticate with Google in development.
- Gmail and Calendar data can be imported.
- At least one seeded/demo scenario produces a high-priority intervention.
- The intervention appears in the web dashboard.
- The same intervention appears in the desktop overlay without restarting the desktop process.
- `Done` persists the resolved state.
- `Remind me later` hides the intervention and re-creates/delivers it when the snooze time expires.
- LLM output is schema-valid before being persisted.
- The system can run entirely with demo data when provider credentials are absent.

## 8. Phase 2 goals

Turn the prototype into a useful personal product.

- Proper user accounts.
- Durable OAuth credentials.
- Incremental sync where practical.
- Background worker with Redis/BullMQ.
- Slack integration.
- Better notification controls.
- User-configurable quiet hours.
- User feedback on relevance.
- Basic preference memory.
- Action proposals without automatic execution.

## 9. Phase 3 goals

Turn the assistant into an agentic operations layer.

- Structured long-term memory.
- Tool/action layer.
- Approval policies.
- Drafting and controlled actions.
- More integrations.
- Personalized prioritization.
- Explainable intervention history.
- More advanced character states and animation.

## 10. Product principles

- Interrupt only when the expected value of interruption is positive.
- Be concise and actionable.
- Explain why an item matters.
- Make the source traceable.
- User control always wins.
- False positives are worse than missing a low-value item.
