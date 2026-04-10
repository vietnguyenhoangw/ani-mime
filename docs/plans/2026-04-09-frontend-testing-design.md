# Frontend Testing Design

Add a two-layer test suite: Vitest + Testing Library for component/hook tests, Playwright for E2E smoke tests against the dev server.

## Tooling

| Layer | Runner | Environment | Purpose |
|-------|--------|-------------|---------|
| Component/hook | Vitest + @testing-library/react | jsdom | Fast, isolated tests for all React code |
| E2E smoke | Playwright | Chromium | Real browser against Vite dev server + mock HTTP :1234 |

### New dependencies (all devDependencies)

- `vitest`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `jsdom`
- `@playwright/test`

### New scripts

- `test` — `vitest run`
- `test:watch` — `vitest`
- `test:e2e` — `playwright test --config e2e/playwright.config.ts`

## File Structure

```
src/
  __mocks__/
    setup.ts                  # Global: jest-dom matchers, mock reset
    tauri.ts                  # @tauri-apps/api/core (invoke)
    tauri-event.ts            # @tauri-apps/api/event (listen, emit)
    tauri-menu.ts             # @tauri-apps/api/menu (Menu, MenuItem)
    tauri-window.ts           # @tauri-apps/api/window (getCurrentWindow)
    tauri-store.ts            # @tauri-apps/plugin-store
    tauri-fs.ts               # @tauri-apps/plugin-fs
    tauri-dialog.ts           # @tauri-apps/plugin-dialog
  __tests__/
    components/
      Mascot.test.tsx
      StatusPill.test.tsx
      SpeechBubble.test.tsx
      Settings.test.tsx
      UpdateBanner.test.tsx
      VisitorDog.test.tsx
      DevTag.test.tsx
    hooks/
      useStatus.test.ts
      useDrag.test.ts
      useBubble.test.ts
      useVisitors.test.ts
      usePeers.test.ts
      useScale.test.ts
    App.test.tsx
e2e/
  smoke.spec.ts
  mock-server.ts              # Tiny HTTP server mimicking :1234
  playwright.config.ts
```

## Tauri API Mocking

All `@tauri-apps/*` imports are aliased in `vitest.config.ts` to mock files under `src/__mocks__/`. No production code changes required.

Core mock API:

- `mockInvoke(cmd, response)` — set what `invoke(cmd)` resolves to
- `emitMockEvent(event, payload)` — simulate a Tauri event from the backend
- `resetMocks()` — clear all state between tests

Plugin mocks are thin wrappers (Store = Map, fs = in-memory, dialog = auto-resolve).

## Test Cases

### Hooks

**useStatus**
- Returns "disconnected" initially
- Updates on "status-changed" event
- Returns scenario flag on scenario event
- Cleans up listener on unmount

**useBubble**
- Starts not visible
- Becomes visible on bubble event
- Sets message from payload
- dismiss() hides bubble

**useDrag**
- dragging starts false
- onMouseDown sets dragging true
- Calls Tauri window startDragging

**useVisitors / usePeers**
- Return empty array initially
- Update on visitor/peer events
- Clean up listeners on unmount

**useScale**
- Returns default scale on mount
- Updates on scale change

### Components

**StatusPill**
- Renders correct label per status (idle, busy, service, disconnected, visiting)
- Applies correct CSS class per status
- Glow class when glow prop is true

**Mascot**
- Renders sprite element per status
- Correct sprite source from sprites.ts
- Auto-stop sprites don't loop

**SpeechBubble**
- Hidden when visible=false
- Shows message when visible
- onDismiss called on dismiss click

**UpdateBanner**
- Displays version string
- onDismiss called on dismiss
- (Conditional render tested in App.test)

**VisitorDog**
- Renders pet sprite + nickname
- Positions by index

**Settings**
- Renders form fields
- Loads current settings on mount
- Value changes call invoke

**DevTag**
- Renders DEV label

### Integration (App.test.tsx)

- Default state: Mascot + StatusPill rendered
- SpeechBubble appears on event
- UpdateBanner shown only when not busy/service
- Scenario badge when scenario active
- Visitor dogs rendered from visitor list
- Context menu lists peers

### E2E Smoke (Playwright)

- App loads: sprite visible, status pill shows "disconnected"
- Status transition: POST :1234/start → "busy" sprite + pill
- Idle transition: heartbeat then wait → "idle"
- Speech bubble: trigger → appears → dismiss → gone
- Settings window: opens, form renders, change persists
- Multi-session: two PIDs → highest priority wins

## Configuration

**vitest.config.ts** extends existing vite.config.ts with jsdom environment, setup file, and Tauri module aliases.

**e2e/playwright.config.ts** points at localhost:1420, starts Vite dev server, Chromium only, 30s timeout.

**tsconfig.json** adds vitest/globals and @testing-library/jest-dom types.
