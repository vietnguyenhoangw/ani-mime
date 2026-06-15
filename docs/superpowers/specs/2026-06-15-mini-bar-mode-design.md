# Mini Bar Mode — Design

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Summary

Add a minimize button to the status pill below the pet. Clicking it collapses
the floating pet into a thin **mini bar** that snaps to one of the four screen
edges, stays always-on-top, and can be dragged from edge to edge. The bar shows
the status (color only, no text) plus the session and peer tools, carries a glow
matching the current status, and has a restore button to return to the full pet.

## Goals

- A minimize button in the status pill (below the pet) that switches into mini mode.
- Mini mode is a thin bar that:
  - Floats always-on-top.
  - Snaps flush to the **nearest of the 4 screen edges** (left, top, right, bottom).
  - Within the snapped edge, snaps to the **nearest corner**.
  - Is **vertical** on the left/right edges and **horizontal** on the top/bottom edges.
  - Is draggable; on drag-release it re-snaps to the nearest edge/corner.
- The bar shows, in order: **status dot (color only, no text) → session button →
  peer button → restore button**. No text labels, no numeric count badges.
- The bar carries an outer glow whose color tracks the current status.
- A restore button returns to the full floating pet at its previous position.

## Non-Goals

- No persistence: the app always launches as the full pet. Mini mode and the
  chosen corner reset every launch.
- No second Tauri window for the bar (we reshape the existing main window).
- No new status types or backend changes — mini mode is purely a frontend
  presentation of the existing `Status`.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Restore interaction | Restore button on the bar |
| Position along edge | Snap to nearest corner |
| Persistence | Remember nothing (always launch as full pet) |
| Bar contents | Dot + session + peer + restore, **no count badges** |
| Architecture | Reuse the main window with a `mode` toggle (not a separate window) |

## Architecture

Reuse the single main window. Lift a `mode: 'pet' | 'mini'` state into `App.tsx`
via a new `useMiniMode` hook. `App` renders either the existing pet column or a
new `<MiniBar>` component based on `mode`.

This follows the existing pattern: the main window is already resized and
repositioned at runtime throughout `App.tsx` (bubble-grow, visitor-grow,
session-dropdown-grow). Reshaping it into a bar is the same mechanism
(`win.setSize` + `win.setPosition`).

### New / changed units

| Unit | Responsibility |
|------|----------------|
| `src/hooks/useMiniMode.ts` | Owns `mode` state + `enterMini()` / `exitMini()`. Saves the pet's pre-minimize position and restores it on exit. |
| `src/components/MiniBar.tsx` | Renders the bar: status dot, session button, peer button, restore button. Receives `status`, `orientation`, and the tool handlers. |
| `src/utils/snap.ts` | Pure `computeSnap(winPos, winSize, monitor, margins)` → `{ x, y, orientation, edge, corner }`. Unit-testable, no Tauri calls. |
| `src/hooks/useMiniSnap.ts` | Wires native drag-release → read `outerPosition()` + `currentMonitor()` → `computeSnap` → `setPosition`. Also resizes the window to bar dimensions on enter and stores orientation. |
| `src/components/StatusPill.tsx` | Add the minimize button to `pill-actions`. |
| `src/App.tsx` | Branch render on `mode`; gate the pet-mode window effects while in mini mode. |
| `src/styles/mini-bar.css` | Bar layout (horizontal/vertical), status-color glow. |

## Behavior

### Entering mini mode

1. User clicks the minimize button in the status pill.
2. `useMiniMode.enterMini()`:
   - Records the current pet window position (logical) for later restore.
   - Sets `mode = 'mini'`.
3. On `mode === 'mini'`, the mini-mode effect:
   - Resizes the window to the bar size for the **initial orientation**
     (default horizontal at the bottom edge, or wherever the snap puts it).
   - Computes the snap target from the current position and snaps there.

### Exiting mini mode

1. User clicks the restore button on the bar.
2. `useMiniMode.exitMini()`:
   - Sets `mode = 'pet'`.
   - Restores the saved pet window size (default pet size) and the saved
     pre-minimize position.

### Snapping & orientation

- Native drag is kept: `getCurrentWindow().startDragging()`. The `await`
  resolves on drag-end (the existing `useDrag` relies on this), so on resolve we:
  1. Read `outerPosition()` and `currentMonitor()` (position, size, scaleFactor).
  2. Call `computeSnap()`:
     - Find the **nearest of the 4 edges** by distance from the window center to
       each monitor edge.
     - Snap the bar flush to that edge with an ~8px margin (plus extra top
       margin to clear the macOS menu bar on the top edge).
     - Within the edge, snap to the **nearest corner** (the nearer of the edge's
       two ends).
     - Derive `orientation`: left/right → `'vertical'`, top/bottom → `'horizontal'`.
  3. If orientation changed, resize the window to the new bar dimensions
     (swap width/height) before/while setting position so the bar isn't clipped.
  4. `setPosition()` to the snapped coordinates.

`computeSnap` is a pure function (no Tauri) taking plain numbers so it can be
unit-tested directly.

### Bar layout & glow

- **Horizontal bar:** ~`140 × 36` logical (scaled by `useScale`).
- **Vertical bar:** ~`36 × 140` logical (scaled).
- Contents in order: status dot → session button → peer button → restore button.
  No text, no numeric count badges. The dot is color-only.
- **Glow:** the bar element carries an outer `box-shadow` glow whose color is
  driven by the current status, reusing the dot-color CSS custom properties
  already defined in `status-pill.css` (busy/service/idle/disconnected/etc.).
  The glow updates live as `useStatus()` changes.

### Tools in bar shape

- **Peer popover** is already its own always-on-top window (`peer-list`), so it
  works in mini mode unchanged except for positioning. `computePopoverScreenPos`
  (in `StatusPill.tsx`) becomes **edge-aware**: it opens the popover *inward*
  from the bar — to the right of a left-edge bar, to the left of a right-edge
  bar, above a bottom-edge bar, below a top-edge bar.
- **Session list** is currently an *in-window* dropdown that grows the main
  window to 400px tall. In mini mode the session button **grows the bar window
  into a small panel that expands inward from the snapped corner**, reusing the
  existing dropdown markup, then shrinks back to the bar when closed. This keeps
  a single window and reuses the existing dropdown component rather than building
  a second window.

### Effect gating

While `mode === 'mini'`, the pet-mode window effects in `App.tsx` are
short-circuited so only mini-mode logic controls the window size/position:

- `useWindowDefaultSize(...)` — paused.
- Bubble-grow effect — skipped.
- Visitor-grow effect — skipped.
- Session-dropdown-grow effect — replaced by the mini-mode panel-grow path.

(The bubble/visitor/effect *visuals* themselves are part of the pet column and
won't render in mini mode since the pet column is replaced by `<MiniBar>`.)

## Data Flow

```
Minimize click → useMiniMode.enterMini() → mode='mini'
  → App renders <MiniBar> instead of pet column
  → mini-mode effect: setSize(bar) + computeSnap + setPosition
  → glow/dot driven by useStatus() (status-changed event, unchanged)

Drag bar → startDragging() resolves on release
  → useMiniSnap: outerPosition + currentMonitor → computeSnap
  → (resize if orientation changed) + setPosition

Restore click → useMiniMode.exitMini() → mode='pet'
  → App renders pet column → restore saved size + position
```

## Error Handling

- All `setSize` / `setPosition` / `currentMonitor` calls are wrapped in
  try/catch (consistent with existing `App.tsx` resize effects); failures log to
  `console.error` with a `[mini-bar]` tag and leave the window where it is.
- If `currentMonitor()` returns null, fall back to snapping against the window's
  current screen assuming origin `(0,0)` and a conservative default size, or skip
  snapping for that release (log a warning) — the bar stays where dropped.

## Testing

Per project conventions, every interactive/observable element gets a `data-testid`:

- `pill-action-minimize` — the minimize button in the status pill.
- `mini-bar` — the bar container (also exposes `data-orientation`).
- `mini-bar-dot` — the status dot.
- `mini-bar-action-task`, `mini-bar-action-lan` — the tool buttons.
- `mini-bar-restore` — the restore button.

Tests:

- **Unit (Vitest):** `computeSnap()` — table of (position, size, monitor) →
  expected `{ edge, corner, orientation, x, y }` covering all four edges and both
  corners per edge, plus the menu-bar top margin.
- **Unit (RTL):** `<MiniBar>` renders the four elements in order; the dot class
  tracks `status`; clicking minimize/restore/tools fires the right handlers.
- **E2e (Playwright):** click minimize → assert `mini-bar` present and the pet
  column gone; assert window resized via `__MOCK_WINDOW_SIZES__`; click restore →
  assert pet column returns. Use `getByTestId` / `getByRole` per selector
  priority.

## Open Risks

- `startDragging()` resolving on drag-end is relied upon for snap timing. If it
  resolves early on some platform, add an `onMoved`-debounced re-snap as a
  fallback (the existing `StatusPill` already uses `onMoved`).
- `currentMonitor()` does not expose the work area (dock/menubar insets) in all
  Tauri versions; we approximate with fixed margins. Acceptable for v1; can be
  refined later.
