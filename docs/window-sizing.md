# Window Sizing & Bounds

The Ani-Mime main window auto-sizes to fit its content, with a stable baseline and named "growth modes" for content that temporarily needs more room (a speech bubble, a session list, visiting pets). This doc is the reference for how that pipeline fits together — read it before touching any `setSize` call or any CSS that affects `.container` dimensions.

## Baseline

**320 × 250** CSS px. Always at least this big, on every platform, in every state.

| Where | What |
|---|---|
| `src/styles/app.css` → `.container` | `min-width: 320px; min-height: 250px` |
| `src-tauri/tauri.conf.json` main window | `width: 320, height: 250` (matches baseline so the first frame paints correctly with no shrink-to-fit flash) |
| `src/App.tsx` | `BASELINE_WIDTH = 320` constant |

When no growth mode is active the window collapses back to this size.

## Mechanics

The native Tauri window tracks the **container's** layout box.

```
┌─ Tauri window (native) ──────────────────────┐
│ #root (100% × 100%, flex)                    │
│   ┌─ .container (min 320 × 250) ─────────┐   │
│   │                                       │   │
│   │   .main-col     .visitors-col         │   │
│   │                                       │   │
│   └───────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

- **`useWindowAutoSize`** (`src/hooks/useWindowAutoSize.ts`) puts a `ResizeObserver` + `MutationObserver` on `.container` and calls `win.setSize(offsetWidth, offsetHeight)` whenever it changes.
- **`.container` min-width / min-height** sets the floor. `useWindowAutoSize` propagates that to the native window.
- **`#root`** is always `100% × 100%` — i.e. it matches the webview which matches the Tauri window.

The invariant is: **`window = container`**. Anything that wants to change the window size must change the container size (via CSS / padding), or explicitly call `setSize` while `useWindowAutoSize` is paused.

## Growth modes

Each mode follows the same "session-dropdown pattern":

1. `useWindowAutoSize` is paused for the duration (via a flag in its `paused` argument in `App.tsx`).
2. An effect in `App.tsx` (or `StatusPill.tsx` for the dropdown's max-height) computes the target size.
3. `setPosition` + `setSize` are fired together in `Promise.all` so macOS applies both in the same native frame — this is what actually makes the resize land reliably on a `resizable: false` + `transparent: true` window.
4. `setPosition` shifts by `dx/2` (half the width delta) so the sprite stays visually anchored — the window grows outward from its center instead of from its top-left.
5. On mode-end, a saved pre-grow position is restored and `setSize` falls back to `container.offsetWidth/Height`.

### Session dropdown

**File:** `src/App.tsx` (the `sessionOpen` effect) + `src/components/StatusPill.tsx` (dropdown max-height).

- Window height → **`max(currentHeight, SESSION_DROPDOWN_WINDOW_HEIGHT)`**, which is **400**.
- Width is not changed.
- The dropdown itself is `position: fixed`, inside the window. `StatusPill` computes its `max-height` as `400 - dropdownTop - 10` (bottom margin), so long session lists scroll (`overflow-y: auto`) inside the dropdown instead of running past the window edge.
- Constant: `SESSION_DROPDOWN_WINDOW_HEIGHT` in `App.tsx`.

### Visitors (1–3 other pets)

**File:** `src/App.tsx` (the `visitors.length` effect).

- Window width → **500** (hardcoded).
- Window height → `max(250, container.offsetHeight)` — height follows natural content, but never below baseline.
- The `.container.has-visitors` class (set when `visitors.length > 0`) also lifts `.container`'s `min-width` from 320 → 500 in CSS so layout stays consistent with the native window size.

**Important:** `src/styles/visitor.css` absolute-positions `.visitor-greeting` *above* each `visitor-dog`. If the greeting were in the flex flow, each visitor-dog would grow to the greeting's `max-width` (180–220 px), which would push 3 visitors well past 500. Don't revert that.

### Speech bubble

**File:** `src/App.tsx` (the `visible` / `bubbleExtra` effect) + `src/styles/app.css` + `src/styles/speech-bubble.css`.

The speech bubble is `position: absolute` inside `.mascot-wrap`, so it doesn't contribute to `offsetWidth/Height`. To make the window grow around it:

1. A `useLayoutEffect` measures the rendered bubble with `ResizeObserver` after it mounts.
2. It computes `extraTop` (height overflow above the sprite) and `extraH` (width overflow past the 320 baseline).
3. Those values feed two CSS custom properties set inline on `.container`: `--bubble-extra-top` and `--bubble-extra-h`.
4. `.container`'s padding uses `calc()` to absorb those extras, so `offsetWidth/Height` grows.
5. A separate `useEffect` drives `setPosition` + `setSize` from the new dimensions and shifts the window position by `(−extraH, −extraTop)` to keep the sprite anchored.

Constants (`App.tsx`): `BASE_PAD_TOP`, `BASE_PAD_HORIZONTAL`, `BUBBLE_OVERLAP_PX`, `SPRITE_NATIVE_WIDTH`, `BASELINE_WIDTH`. If you change the bubble's CSS `max-width` or the `.container` base padding, update these so the math stays consistent.

### How modes combine

They can stack — e.g. a visitor arrives while the session list is open. In that case:

- `useWindowAutoSize` pause condition is an `OR` of all mode flags.
- Each effect's `return`-early guards prevent the "inner" modes from fighting the "outer" one (session-dropdown explicitly reads `currentWidth` and keeps it, so 500 from visitor mode survives).
- Restore paths rely on saved positions, so un-stacking restores the correct previous state.

If you add a fourth mode, follow the same rules:
- Add a pause flag to `useWindowAutoSize`.
- Use the session-dropdown setSize + setPosition pattern inside a `Promise.all`.
- Save pre-grow position in a ref; clear it on restore.
- Consider what happens when another mode is already active (the new mode can read `containerRef.current.offsetWidth/Height` to compute its target relative to the current state, same as session-dropdown does).

## Sprite scale (0.5, 1, 1.5, 2)

Changing the sprite scale (Settings → pet size) only updates the `--sprite-scale` CSS variable on `documentElement`. The sprite grows in CSS, `.container` naturally grows with it (mascot gets wider/taller), `useWindowAutoSize`'s `ResizeObserver` fires, and the window resizes.

No hardcoded per-scale window dimensions anymore (the previous `WINDOW_SIZES` map in `useScale.ts` was removed because it was calling `setSize(500, 220)` at scale=1, which fought the auto-size pipeline).

## Dev outlines (App Bounds / Container / Root)

Visual debugging tool for the sizing pipeline. Enable dev mode (click the Version label 10 times in Settings) and three outlines appear on the main window:

| Toggle | Color | Element |
|---|---|---|
| App Bounds | purple `#5e5ce6` | `.container` |
| Container | red `#ff3b30` | `.container` content area (inside base padding) |
| Root | green `#34c759` | `#root` (= full webview) |

Hooks: `src/hooks/useDevAppBounds.ts`, `useDevContainerBounds.ts`, `useDevRootBounds.ts`. Each listens to both its own `dev-*-bounds-changed` event (for individual toggling in the Superpower tool) and `dev-mode-changed` (to auto-sync with dev mode).

In `App.tsx` the outline states are gated with `devMode && toggle`, so if dev mode is off, outlines never render — even if a `dev-*-bounds-changed` event leaks in.

## Change recipes

### Change the baseline size

1. `src/styles/app.css` → `.container { min-width: …; min-height: … }`
2. `src-tauri/tauri.conf.json` → main window `width` / `height` (match baseline)
3. `src/App.tsx` → update `BASELINE_WIDTH` constant
4. Check `SESSION_DROPDOWN_MIN_WIDTH` (currently 320) — it's the floor the session effect uses for `max(currentWidth, …)`. Keep ≥ baseline width.

### Change the visitor-mode width

1. `src/App.tsx` → inside the `visitors` effect, change `newWidth = 500`.
2. `src/styles/app.css` → `.container.has-visitors { min-width: 500px }` — keep in sync.

### Change the session-dropdown height

1. `src/App.tsx` → `SESSION_DROPDOWN_WINDOW_HEIGHT`.
2. `src/components/StatusPill.tsx` → the `SESSION_WINDOW_HEIGHT` local constant inside the `sessionOpen` effect (same number, used to compute the dropdown's `max-height`).

### Add a new growth mode

See "How modes combine" above. The implementation template is the session-dropdown effect in `App.tsx` — copy its shape.

## Related files

| Path | Responsibility |
|---|---|
| `src/hooks/useWindowAutoSize.ts` | Base auto-size pipeline (container → window) |
| `src/App.tsx` | All growth-mode effects, pause coordination, constants |
| `src/components/StatusPill.tsx` | Session dropdown's max-height |
| `src/hooks/useBubble.ts` | Speech bubble state source |
| `src/hooks/useVisitors.ts` | Visitor state source (with Strict-Mode dedup) |
| `src/hooks/useScale.ts` | Sprite scale — writes CSS var only |
| `src/styles/app.css` | `.container` baseline + `.has-visitors` + dev-outline CSS |
| `src/styles/speech-bubble.css` | Bubble sizing, absolute position, animation |
| `src/styles/visitor.css` | Visitor-dog layout, absolute-positioned greeting |
| `src-tauri/tauri.conf.json` | Native initial size |
