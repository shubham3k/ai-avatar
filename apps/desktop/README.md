# Desktop Overlay

Electron application providing the visual interface for AI Executive Agent interventions.

## Running the Desktop App

### Quick Start with Demo Data

```bash
# From project root - loads demo data and starts both API + desktop
pnpm dev:desktop
```

This command:
1. Loads 4 demo interventions into the database
2. Starts the API server on port 4000
3. Launches the Electron desktop overlay

### Manual Start

```bash
# Ensure API is running first
cd ../api
pnpm dev

# In another terminal, start desktop app
cd ../desktop
pnpm electron:dev
```

## Demo Data

The desktop app is designed to work with demo interventions loaded via:

```bash
# From project root
pnpm db:demo-tasks
```

This creates 4 test interventions:
1. **Critical**: Launch checklist decision
2. **High**: Q4 campaign budget approval
3. **Medium**: Follow up with product team
4. **Low**: Weekly notes review

## Features

### Intervention Cards
- Display title, message, and priority level
- Color-coded by priority (critical, high, medium, low)
- Character animation for visual engagement

### Actions
- **Done**: Marks intervention as resolved, shows next intervention
- **Remind me later**: Snoozes intervention for later

### Workflow
1. Interventions appear in priority order
2. User clicks "Done" or "Remind me later"
3. API updates intervention status
4. Next intervention appears automatically

## Architecture

```text
src/
  main/
    index.ts           # Electron main process
    config.ts          # Configuration
    api-client.ts      # Backend API client
    ipc/
      register-ipc.ts  # IPC handlers
    windows/
      overlay-window.ts
    preload.ts         # Preload script
    preload.cjs        # Compiled preload (CommonJS)
  renderer/
    App.tsx            # Main React component
    bridge.ts          # IPC bridge to main process
    components/
      Character.tsx    # Animated character
      InterventionCard.tsx
    state/
      store.ts         # Application state
    styles.css
    main.tsx
    index.html
```

## Testing

```bash
# Run tests
pnpm test

# Run specific test
pnpm vitest run src/main/api-client.test.ts
```

## Configuration

The desktop app connects to the API at `http://localhost:4000` by default.

To change the API URL, set in your environment:
```env
API_BASE_URL=http://localhost:4000
```

## Development Notes

- The renderer never contains provider credentials
- All sensitive operations happen in the main process
- API calls go through the main process via IPC
- The preload script exposes a narrow bridge to the renderer
