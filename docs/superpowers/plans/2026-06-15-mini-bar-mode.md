# Mini Bar Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimize button that collapses the floating pet into a thin status bar that snaps to any of the four screen edges, glows with the current status color, and exposes the session + peer tools plus a restore button.

**Architecture:** Reuse the single main window (no new Tauri window). A `useMiniMode` hook owns a `mode: 'pet' | 'mini'` state and the window resize/snap mechanics. `App` renders either the existing pet column or a new `<MiniBar>`. Edge/corner snapping is a pure `computeSnap()` function so it is unit-testable without Tauri. Session-grouping logic is extracted into a shared util and a `<SessionDropdown>` component so both the pet pill and the mini bar reuse it.

**Tech Stack:** React 19, TypeScript, Tauri 2 (`@tauri-apps/api/window`), Vitest + React Testing Library, Playwright (e2e). Package manager: **Bun**.

---

## File Structure

**Create:**
- `src/utils/snap.ts` — pure edge/corner snap math + bar constants. No Tauri imports.
- `src/utils/popoverPos.ts` — pure inward-popover position math for mini mode.
- `src/utils/sessionGroups.ts` — session grouping helpers extracted from `StatusPill.tsx`.
- `src/components/SessionDropdown.tsx` — presentational session-list dropdown, shared by pill + mini.
- `src/components/MiniBar.tsx` — the bar UI (dot, session, peer, restore) + glow + orientation.
- `src/hooks/useMiniMode.ts` — `mode` state + enter/exit/snap window mechanics.
- `src/styles/mini-bar.css` — bar layout + status glow.
- `src/__tests__/utils/snap.test.ts`
- `src/__tests__/utils/popoverPos.test.ts`
- `src/__tests__/components/MiniBar.test.tsx`

**Modify:**
- `src/__mocks__/tauri-window.ts` — add `currentMonitor`, `LogicalPosition`, `LogicalSize`, `outerSize`, `scaleFactor`, `toLogical`.
- `src/hooks/useDrag.ts` — accept an `onDragEnd` callback; ignore drags that start on a `<button>`.
- `src/components/StatusPill.tsx` — add the minimize button; import grouping from `sessionGroups.ts`; render `<SessionDropdown>`.
- `src/App.tsx` — branch render on `mode`; gate pet-mode resize effects while in mini mode.
- `e2e/mini-bar.spec.ts` — new e2e (create).

---

## Task Group 1: Snap math (pure, no Tauri)

### Task 1: `computeSnap()` and bar constants

**Files:**
- Create: `src/utils/snap.ts`
- Test: `src/__tests__/utils/snap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/utils/snap.test.ts
import { describe, it, expect } from "vitest";
import { computeSnap, BAR_LONG, BAR_SHORT, DEFAULT_MARGINS } from "../../utils/snap";

const MON = { x: 0, y: 0, width: 1000, height: 800 };
const LONG = 168;
const SHORT = 40;

describe("computeSnap", () => {
  it("snaps to the LEFT edge, TOP corner (vertical bar)", () => {
    // window center at (50, 100) -> nearest edge is left, top half
    const r = computeSnap({ x: 30, y: 16, width: 40, height: 168 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("left");
    expect(r.orientation).toBe("vertical");
    expect(r.width).toBe(SHORT);
    expect(r.height).toBe(LONG);
    expect(r.x).toBe(8);          // monitor.x + edge margin
    expect(r.y).toBe(30);         // monitor.y + menuBar margin (top corner)
  });

  it("snaps to the RIGHT edge, BOTTOM corner (vertical bar)", () => {
    // center (950, 700)
    const r = computeSnap({ x: 930, y: 616, width: 40, height: 168 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("right");
    expect(r.orientation).toBe("vertical");
    expect(r.x).toBe(1000 - SHORT - 8); // 952
    expect(r.y).toBe(800 - LONG - 8);   // 624 (bottom corner)
  });

  it("snaps to the TOP edge, RIGHT corner (horizontal bar)", () => {
    // center (900, 50)
    const r = computeSnap({ x: 816, y: 30, width: 168, height: 40 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("top");
    expect(r.orientation).toBe("horizontal");
    expect(r.width).toBe(LONG);
    expect(r.height).toBe(SHORT);
    expect(r.y).toBe(30);                 // menuBar margin
    expect(r.x).toBe(1000 - LONG - 8);    // 824 (right corner)
  });

  it("snaps to the BOTTOM edge, LEFT corner (horizontal bar)", () => {
    // center (100, 750)
    const r = computeSnap({ x: 16, y: 730, width: 168, height: 40 }, MON, LONG, SHORT, DEFAULT_MARGINS);
    expect(r.edge).toBe("bottom");
    expect(r.orientation).toBe("horizontal");
    expect(r.y).toBe(800 - SHORT - 8);    // 752
    expect(r.x).toBe(8);                   // left corner
  });

  it("exports sane default bar constants", () => {
    expect(BAR_LONG).toBeGreaterThan(BAR_SHORT);
    expect(DEFAULT_MARGINS.menuBar).toBeGreaterThanOrEqual(DEFAULT_MARGINS.edge);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/__tests__/utils/snap.test.ts`
Expected: FAIL — `Cannot find module '../../utils/snap'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/snap.ts
export type Orientation = "horizontal" | "vertical";
export type Edge = "left" | "right" | "top" | "bottom";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapMargins {
  /** Gap from screen edges, in logical px. */
  edge: number;
  /** Extra gap from the top edge to clear the macOS menu bar, in logical px. */
  menuBar: number;
}

export interface SnapResult {
  x: number;
  y: number;
  edge: Edge;
  orientation: Orientation;
  /** Bar window width at this orientation (logical px). */
  width: number;
  /** Bar window height at this orientation (logical px). */
  height: number;
}

/** Bar dimensions in logical px (before display scale). Long = along the edge. */
export const BAR_LONG = 168;
export const BAR_SHORT = 40;

export const DEFAULT_MARGINS: SnapMargins = { edge: 8, menuBar: 30 };

/**
 * Given the current window rect and the monitor rect (both logical px),
 * pick the nearest of the four edges, then the nearest corner on that edge,
 * and return the snapped top-left position + the bar orientation/size.
 *
 * Pure: no Tauri calls, plain numbers in and out, so it is unit-testable.
 */
export function computeSnap(
  win: Rect,
  monitor: Rect,
  barLong: number,
  barShort: number,
  margins: SnapMargins = DEFAULT_MARGINS
): SnapResult {
  const cx = win.x + win.width / 2;
  const cy = win.y + win.height / 2;

  const distLeft = cx - monitor.x;
  const distRight = monitor.x + monitor.width - cx;
  const distTop = cy - monitor.y;
  const distBottom = monitor.y + monitor.height - cy;

  const min = Math.min(distLeft, distRight, distTop, distBottom);

  let edge: Edge;
  if (min === distLeft) edge = "left";
  else if (min === distRight) edge = "right";
  else if (min === distTop) edge = "top";
  else edge = "bottom";

  const vertical = edge === "left" || edge === "right";
  const width = vertical ? barShort : barLong;
  const height = vertical ? barLong : barShort;

  let x: number;
  let y: number;

  if (vertical) {
    x =
      edge === "left"
        ? monitor.x + margins.edge
        : monitor.x + monitor.width - width - margins.edge;
    const topHalf = cy < monitor.y + monitor.height / 2;
    y = topHalf
      ? monitor.y + margins.menuBar
      : monitor.y + monitor.height - height - margins.edge;
  } else {
    y =
      edge === "top"
        ? monitor.y + margins.menuBar
        : monitor.y + monitor.height - height - margins.edge;
    const leftHalf = cx < monitor.x + monitor.width / 2;
    x = leftHalf
      ? monitor.x + margins.edge
      : monitor.x + monitor.width - width - margins.edge;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    edge,
    orientation: vertical ? "vertical" : "horizontal",
    width,
    height,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/__tests__/utils/snap.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/snap.ts src/__tests__/utils/snap.test.ts
git commit -m "feat(mini-bar): pure edge/corner snap math"
```

---

## Task Group 2: Tauri window mock additions

### Task 2: Extend the window mock for monitor + logical types

**Files:**
- Modify: `src/__mocks__/tauri-window.ts`

- [ ] **Step 1: Replace the mock with the extended version**

Replace the entire contents of `src/__mocks__/tauri-window.ts` with:

```ts
/**
 * Mock for @tauri-apps/api/window
 */

export class LogicalPosition {
  type = "Logical" as const;
  constructor(public x: number, public y: number) {}
}

export class LogicalSize {
  type = "Logical" as const;
  constructor(public width: number, public height: number) {}
}

export class PhysicalPosition {
  type = "Physical" as const;
  constructor(public x: number, public y: number) {}
  toLogical(_sf: number) {
    return new LogicalPosition(this.x, this.y);
  }
}

export class PhysicalSize {
  type = "Physical" as const;
  constructor(public width: number, public height: number) {}
  toLogical(_sf: number) {
    return new LogicalSize(this.width, this.height);
  }
}

const mockWindow = {
  label: "main",
  startDragging: vi.fn(async () => {}),
  setPosition: vi.fn(async () => {}),
  outerPosition: vi.fn(async () => new PhysicalPosition(0, 0)),
  outerSize: vi.fn(async () => new PhysicalSize(160, 240)),
  setSize: vi.fn(async () => {}),
  scaleFactor: vi.fn(async () => 1),
  hide: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
};

export function getCurrentWindow() {
  return mockWindow;
}

export const currentMonitor = vi.fn(async () => ({
  name: "mock",
  scaleFactor: 1,
  position: new PhysicalPosition(0, 0),
  size: new PhysicalSize(1000, 800),
}));

export function resetMocks() {
  mockWindow.startDragging.mockClear();
  mockWindow.setPosition.mockClear();
  mockWindow.outerPosition.mockClear();
  mockWindow.outerSize.mockClear();
  mockWindow.setSize.mockClear();
  mockWindow.scaleFactor.mockClear();
  mockWindow.hide.mockClear();
  mockWindow.close.mockClear();
  currentMonitor.mockClear();
}
```

- [ ] **Step 2: Run the existing suite to verify nothing broke**

Run: `bunx vitest run`
Expected: PASS — the full existing suite still green (the mock is a superset of the old one).

- [ ] **Step 3: Commit**

```bash
git add src/__mocks__/tauri-window.ts
git commit -m "test(mini-bar): extend tauri-window mock with monitor + logical types"
```

---

## Task Group 3: MiniBar component (core: dot + restore + glow)

### Task 3: MiniBar renders dot + restore, with orientation + status classes

**Files:**
- Create: `src/components/MiniBar.tsx`
- Create: `src/styles/mini-bar.css`
- Test: `src/__tests__/components/MiniBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/MiniBar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MiniBar } from "../../components/MiniBar";

describe("MiniBar", () => {
  it("renders the status dot with the status class", () => {
    render(<MiniBar status="busy" orientation="horizontal" onRestore={() => {}} />);
    const dot = screen.getByTestId("mini-bar-dot");
    expect(dot).toHaveClass("dot");
    expect(dot).toHaveClass("busy");
  });

  it("reflects orientation via data-orientation + class", () => {
    render(<MiniBar status="idle" orientation="vertical" onRestore={() => {}} />);
    const bar = screen.getByTestId("mini-bar");
    expect(bar).toHaveAttribute("data-orientation", "vertical");
    expect(bar).toHaveClass("vertical");
    expect(bar).toHaveClass("idle");
  });

  it("calls onRestore when the restore button is clicked", () => {
    const onRestore = vi.fn();
    render(<MiniBar status="idle" orientation="horizontal" onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId("mini-bar-restore"));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/__tests__/components/MiniBar.test.tsx`
Expected: FAIL — `Cannot find module '../../components/MiniBar'`.

- [ ] **Step 3: Write the component**

```tsx
// src/components/MiniBar.tsx
import type { Status } from "../types/status";
import type { Orientation } from "../utils/snap";
import "../styles/mini-bar.css";

interface MiniBarProps {
  status: Status;
  orientation: Orientation;
  onRestore: () => void;
}

/**
 * The collapsed "mini bar" view. Reuses the `.dot` status classes from
 * status-pill.css (loaded globally because StatusPill is imported by App).
 * The status class on the root drives the glow color (see mini-bar.css).
 */
export function MiniBar({ status, orientation, onRestore }: MiniBarProps) {
  return (
    <div
      data-testid="mini-bar"
      data-orientation={orientation}
      className={`mini-bar ${orientation} ${status}`}
    >
      <span data-testid="mini-bar-dot" className={`dot ${status}`} />
      <button
        type="button"
        data-testid="mini-bar-restore"
        className="mini-bar-btn"
        aria-label="Restore pet"
        title="Restore"
        onClick={onRestore}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4h7v2H6v5H4V4zm9 0h7v7h-2V6h-5V4zM4 13h2v5h5v2H4v-7zm14 0h2v7h-7v-2h5v-5z" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

```css
/* src/styles/mini-bar.css */

/* Collapse the pet container's pet-size minimums while in mini mode. */
.container.mini-mode {
  min-width: 0 !important;
  min-height: 0 !important;
  padding: 0;
}

.mini-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 20px;
  background: var(--bg-pill);
  border: 1px solid var(--border-pill);
  transition: box-shadow 0.3s, border-color 0.2s;
}

.mini-bar.vertical {
  flex-direction: column;
  padding: 10px 0;
}

.mini-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 6px;
  background: var(--bg-pill-hover);
  border: 1px solid var(--border-pill);
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.mini-bar-btn:hover {
  border-color: var(--border-pill-hover);
}

/* Status glow — colors mirror the .dot.* values in status-pill.css. */
.mini-bar.idle         { box-shadow: 0 0 8px rgba(52, 199, 89, 0.5),  0 0 18px rgba(52, 199, 89, 0.3); }
.mini-bar.busy         { box-shadow: 0 0 8px rgba(255, 59, 48, 0.5),  0 0 18px rgba(255, 59, 48, 0.3); }
.mini-bar.service      { box-shadow: 0 0 8px rgba(94, 92, 230, 0.5),  0 0 18px rgba(94, 92, 230, 0.3); }
.mini-bar.searching    { box-shadow: 0 0 8px rgba(255, 204, 0, 0.5),  0 0 18px rgba(255, 204, 0, 0.3); }
.mini-bar.initializing { box-shadow: 0 0 8px rgba(255, 159, 10, 0.5), 0 0 18px rgba(255, 159, 10, 0.3); }
.mini-bar.visiting     { box-shadow: 0 0 8px rgba(175, 82, 222, 0.5), 0 0 18px rgba(175, 82, 222, 0.3); }
.mini-bar.disconnected { box-shadow: 0 0 8px rgba(99, 99, 102, 0.4); }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run src/__tests__/components/MiniBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/MiniBar.tsx src/styles/mini-bar.css src/__tests__/components/MiniBar.test.tsx
git commit -m "feat(mini-bar): MiniBar component with status glow + orientation"
```

---

## Task Group 4: useMiniMode hook (window mechanics)

### Task 4: enter/exit/snap window transitions

**Files:**
- Create: `src/hooks/useMiniMode.ts`
- Test: `src/__tests__/hooks/useMiniMode.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/hooks/useMiniMode.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useMiniMode } from "../../hooks/useMiniMode";
import { getCurrentWindow, resetMocks } from "../../__mocks__/tauri-window";

describe("useMiniMode", () => {
  beforeEach(() => resetMocks());

  it("starts in pet mode", () => {
    const { result } = renderHook(() => useMiniMode(1));
    expect(result.current.mode).toBe("pet");
  });

  it("enterMini flips to mini and resizes + positions the window", async () => {
    const { result } = renderHook(() => useMiniMode(1));
    await act(async () => {
      await result.current.enterMini();
    });
    await waitFor(() => expect(result.current.mode).toBe("mini"));
    const win = getCurrentWindow();
    expect(win.setSize).toHaveBeenCalled();
    expect(win.setPosition).toHaveBeenCalled();
  });

  it("exitMini flips back to pet and restores pet size", async () => {
    const { result } = renderHook(() => useMiniMode(1));
    await act(async () => {
      await result.current.enterMini();
    });
    const win = getCurrentWindow();
    win.setSize.mockClear();
    await act(async () => {
      await result.current.exitMini();
    });
    await waitFor(() => expect(result.current.mode).toBe("pet"));
    expect(win.setSize).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/__tests__/hooks/useMiniMode.test.tsx`
Expected: FAIL — `Cannot find module '../../hooks/useMiniMode'`.

- [ ] **Step 3: Write the hook**

```ts
// src/hooks/useMiniMode.ts
import { useCallback, useRef, useState } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { getDefaultPetSize } from "./useWindowDefaultSize";
import {
  computeSnap,
  BAR_LONG,
  BAR_SHORT,
  DEFAULT_MARGINS,
  type Orientation,
  type Rect,
} from "../utils/snap";

export type Mode = "pet" | "mini";

/** Read the current monitor as a logical-pixel rect, or null if unavailable. */
async function monitorLogicalRect(): Promise<Rect | null> {
  const m = await currentMonitor();
  if (!m) return null;
  const sf = m.scaleFactor || 1;
  return {
    x: m.position.x / sf,
    y: m.position.y / sf,
    width: m.size.width / sf,
    height: m.size.height / sf,
  };
}

/**
 * Owns the pet <-> mini transition and the window resize/snap mechanics.
 * No persistence (the app always launches in pet mode).
 */
export function useMiniMode(scale: number) {
  const [mode, setMode] = useState<Mode>("pet");
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const savedPetPosRef = useRef<LogicalPosition | null>(null);

  const snapToNearest = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      const monitor = await monitorLogicalRect();
      if (!monitor) {
        console.warn("[mini-bar] no monitor; leaving bar where dropped");
        return;
      }
      const sf = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(sf);
      const size = (await win.outerSize()).toLogical(sf);
      const barLong = Math.round(BAR_LONG * scale);
      const barShort = Math.round(BAR_SHORT * scale);
      const snap = computeSnap(
        { x: pos.x, y: pos.y, width: size.width, height: size.height },
        monitor,
        barLong,
        barShort,
        DEFAULT_MARGINS
      );
      setOrientation(snap.orientation);
      await win.setSize(new LogicalSize(snap.width, snap.height));
      await win.setPosition(new LogicalPosition(snap.x, snap.y));
    } catch (err) {
      console.error("[mini-bar] snap failed:", err);
    }
  }, [scale]);

  const enterMini = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      const sf = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(sf);
      savedPetPosRef.current = new LogicalPosition(
        Math.round(pos.x),
        Math.round(pos.y)
      );
    } catch (err) {
      console.error("[mini-bar] capture pet position failed:", err);
    }
    setMode("mini");
    await snapToNearest();
  }, [snapToNearest]);

  const exitMini = useCallback(async () => {
    const win = getCurrentWindow();
    setMode("pet");
    try {
      const def = getDefaultPetSize(scale);
      await win.setSize(new LogicalSize(def.width, def.height));
      const saved = savedPetPosRef.current;
      if (saved) await win.setPosition(saved);
    } catch (err) {
      console.error("[mini-bar] restore failed:", err);
    }
  }, [scale]);

  return { mode, orientation, enterMini, exitMini, snapToNearest };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/__tests__/hooks/useMiniMode.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMiniMode.ts src/__tests__/hooks/useMiniMode.test.tsx
git commit -m "feat(mini-bar): useMiniMode hook for window enter/exit/snap"
```

---

## Task Group 5: Wire into App (minimize button, render branch, effect gating, drag-snap)

### Task 5: useDrag accepts an onDragEnd + ignores button drags

**Files:**
- Modify: `src/hooks/useDrag.ts`
- Test: `src/__tests__/hooks/useDrag.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/hooks/useDrag.test.tsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDrag } from "../../hooks/useDrag";
import { getCurrentWindow, resetMocks } from "../../__mocks__/tauri-window";

function mouseEvent(target: HTMLElement, button = 0) {
  return { button, target } as unknown as React.MouseEvent;
}

describe("useDrag", () => {
  beforeEach(() => resetMocks());

  it("calls onDragEnd after a drag completes", async () => {
    const onDragEnd = vi.fn();
    const { result } = renderHook(() => useDrag(onDragEnd));
    const div = document.createElement("div");
    await act(async () => {
      await result.current.onMouseDown(mouseEvent(div));
    });
    expect(getCurrentWindow().startDragging).toHaveBeenCalled();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("does not start a drag when the target is a button", async () => {
    const { result } = renderHook(() => useDrag());
    const btn = document.createElement("button");
    await act(async () => {
      await result.current.onMouseDown(mouseEvent(btn));
    });
    expect(getCurrentWindow().startDragging).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/__tests__/hooks/useDrag.test.tsx`
Expected: FAIL — `onDragEnd` is not called / button drag still starts.

- [ ] **Step 3: Update the hook**

Replace the contents of `src/hooks/useDrag.ts` with:

```ts
import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useDrag(onDragEnd?: () => void) {
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Don't start a window drag when interacting with the pill dropdown.
      if (target.closest('[data-testid="status-pill-wrap"]')) return;
      // Don't drag when pressing a button (minimize/restore/tools/session).
      if (target.closest("button")) return;
      setDragging(true);
      await getCurrentWindow().startDragging();
      setDragging(false);
      onDragEnd?.();
    },
    [onDragEnd]
  );

  return { dragging, onMouseDown };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/__tests__/hooks/useDrag.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDrag.ts src/__tests__/hooks/useDrag.test.tsx
git commit -m "feat(mini-bar): useDrag onDragEnd callback + ignore button drags"
```

### Task 6: Add the minimize button to StatusPill

**Files:**
- Modify: `src/components/StatusPill.tsx`
- Test: `src/__tests__/components/StatusPill.test.tsx`

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

Add inside the existing `describe("StatusPill", ...)` in `src/__tests__/components/StatusPill.test.tsx`:

```tsx
  it("renders a minimize button and calls onMinimize when clicked", () => {
    const onMinimize = vi.fn();
    render(<StatusPill status="idle" onMinimize={onMinimize} />);
    const btn = screen.getByTestId("pill-action-minimize");
    fireEvent.click(btn);
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it("does not render a minimize button when onMinimize is omitted", () => {
    render(<StatusPill status="idle" />);
    expect(screen.queryByTestId("pill-action-minimize")).toBeNull();
  });
```

Ensure the test file imports `fireEvent` and `vi`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/__tests__/components/StatusPill.test.tsx`
Expected: FAIL — no element with testid `pill-action-minimize`.

- [ ] **Step 3: Add the prop**

In `src/components/StatusPill.tsx`, extend the props interface (after `onOpenChange?`):

```tsx
  /**
   * When provided, renders a minimize button that collapses the pet into
   * mini-bar mode. Omitted in contexts where minimizing isn't allowed.
   */
  onMinimize?: () => void;
```

And update the destructure:

```tsx
export function StatusPill({ status, glow, disabled = false, onOpenChange, onMinimize }: StatusPillProps) {
```

- [ ] **Step 4: Render the button**

In `src/components/StatusPill.tsx`, inside `<div className="pill-actions" data-testid="pill-actions">`, add this as the **first** child (before the session button):

```tsx
          {onMinimize && (
            <button
              type="button"
              data-testid="pill-action-minimize"
              className="pill-action-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                playClickTap();
                onMinimize();
              }}
              aria-label="Minimize to bar"
              title="Minimize to bar"
            >
              <svg
                className="pill-action-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 19h12v2H6z" />
              </svg>
            </button>
          )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run src/__tests__/components/StatusPill.test.tsx`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/components/StatusPill.tsx src/__tests__/components/StatusPill.test.tsx
git commit -m "feat(mini-bar): minimize button in StatusPill"
```

### Task 7: Branch App render on mode + gate pet-mode effects

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

In `src/App.tsx`, add near the other component/hook imports:

```tsx
import { MiniBar } from "./components/MiniBar";
import { useMiniMode } from "./hooks/useMiniMode";
```

- [ ] **Step 2: Instantiate the hook + wire drag-snap**

Replace this line:

```tsx
  const { dragging, onMouseDown } = useDrag();
```

with:

```tsx
  const mini = useMiniMode(scale);
  const { dragging, onMouseDown } = useDrag(
    mini.mode === "mini" ? mini.snapToNearest : undefined
  );
```

Note: `useScale()` is destructured above `useDrag` already (`const { scale } = useScale();`), so `scale` is in scope.

- [ ] **Step 3: Pause the default-size hook while in mini mode**

Replace the `useWindowDefaultSize(...)` call with:

```tsx
  useWindowDefaultSize(
    scale,
    mini.mode === "mini" ||
      effectActive ||
      sessionOpen ||
      sessionClosing ||
      bubbleGrowActive ||
      visitors.length > 0
  );
```

- [ ] **Step 4: Gate the three pet-mode resize effects**

Add `if (mini.mode === "mini") return;` as the **first statement** inside each of these three `useEffect` bodies, and add `mini.mode` to each effect's dependency array:

1. The bubble-grow effect (the one whose deps are `[bubbleGrowActive, sessionOpen, scale]`) → deps become `[bubbleGrowActive, sessionOpen, scale, mini.mode]`.
2. The visitor-grow effect (deps `[visitors.length, scale]`) → `[visitors.length, scale, mini.mode]`.
3. The session-dropdown-grow effect (deps `[sessionOpen, scale]`) → `[sessionOpen, scale, mini.mode]`.

Example for the bubble-grow effect (apply the same pattern to the other two):

```tsx
  useEffect(() => {
    if (mini.mode === "mini") return;
    if (sessionOpen) return;
    const win = getCurrentWindow();
    // ...existing body unchanged...
  }, [bubbleGrowActive, sessionOpen, scale, mini.mode]);
```

- [ ] **Step 5: Branch the render**

Replace the container's `className` and `style` props and its children. Change the opening container tag to:

```tsx
    <div
      ref={containerRef}
      data-testid="app-container"
      className={`container ${mini.mode === "mini" ? "mini-mode" : ""} ${dragging ? "dragging" : ""} ${scenario ? "scenario-active" : ""} ${visitors.length > 0 ? "has-visitors" : ""} ${devAppBounds ? "dev-bounds" : ""} ${devContainerBounds ? "dev-container-bounds" : ""}`}
      style={{
        minWidth:
          mini.mode === "mini"
            ? undefined
            : visitors.length > 0
              ? "500px"
              : `${PET_BASE_WIDTH}px`,
        minHeight: mini.mode === "mini" ? undefined : `${PET_BASE_HEIGHT}px`,
      }}
      onMouseDown={onMouseDown}
    >
```

Then wrap the existing children (the `<div className="main-col">…</div>` and the `{visitors.length > 0 && (<div className="visitors-col">…</div>)}` block) in a mode branch. Immediately after the opening container tag above, the body becomes:

```tsx
      {mini.mode === "mini" ? (
        <MiniBar
          status={status}
          orientation={mini.orientation}
          onRestore={mini.exitMini}
        />
      ) : (
        <>
          <div className="main-col">
            {/* ...existing main-col contents unchanged... */}
          </div>
          {visitors.length > 0 && (
            <div className="visitors-col" data-testid="visitors-col">
              {/* ...existing visitors mapping unchanged... */}
            </div>
          )}
        </>
      )}
```

- [ ] **Step 6: Pass onMinimize to StatusPill**

In the `main-col` branch, add `onMinimize={mini.enterMini}` to the `<StatusPill ... />` element (alongside the existing `status`, `glow`, `disabled`, `onOpenChange` props).

- [ ] **Step 7: Type-check + run the suite**

Run: `npx tsc --noEmit && bunx vitest run`
Expected: tsc clean; all unit tests PASS.

- [ ] **Step 8: Manual smoke test**

Run: `bun run tauri dev`
Verify: clicking the minimize button collapses the pet into a bar that snaps to the nearest edge; the bar glows with the status color; dragging it to another edge re-snaps and flips orientation (vertical on left/right, horizontal on top/bottom); the restore button brings back the full pet at its prior position.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat(mini-bar): wire mini mode into App (render branch + effect gating)"
```

---

## Task Group 6: Peer tool in the mini bar (edge-aware popover)

### Task 8: Inward popover position math

**Files:**
- Create: `src/utils/popoverPos.ts`
- Test: `src/__tests__/utils/popoverPos.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/utils/popoverPos.test.ts
import { describe, it, expect } from "vitest";
import { inwardPopoverPos } from "../../utils/popoverPos";

const BAR = { x: 100, y: 200, width: 40, height: 168 }; // a vertical bar
const PW = 280;
const PH = 260;
const GAP = 8;

describe("inwardPopoverPos", () => {
  it("opens to the RIGHT of a left-edge bar", () => {
    const p = inwardPopoverPos(BAR, "left", PW, PH, GAP);
    expect(p.x).toBe(100 + 40 + GAP); // bar.x + bar.width + gap
    expect(p.y).toBe(200);
  });

  it("opens to the LEFT of a right-edge bar", () => {
    const p = inwardPopoverPos(BAR, "right", PW, PH, GAP);
    expect(p.x).toBe(100 - PW - GAP);
    expect(p.y).toBe(200);
  });

  it("opens BELOW a top-edge bar", () => {
    const hbar = { x: 300, y: 30, width: 168, height: 40 };
    const p = inwardPopoverPos(hbar, "top", PW, PH, GAP);
    expect(p.y).toBe(30 + 40 + GAP);
    expect(p.x).toBe(300);
  });

  it("opens ABOVE a bottom-edge bar", () => {
    const hbar = { x: 300, y: 752, width: 168, height: 40 };
    const p = inwardPopoverPos(hbar, "bottom", PW, PH, GAP);
    expect(p.y).toBe(752 - PH - GAP);
    expect(p.x).toBe(300);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/__tests__/utils/popoverPos.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/popoverPos.ts
import type { Edge, Rect } from "./snap";

export interface Point {
  x: number;
  y: number;
}

/**
 * Top-left position (logical screen px) for a popover that opens *inward*
 * from a snapped mini bar, away from the screen edge it hugs.
 */
export function inwardPopoverPos(
  bar: Rect,
  edge: Edge,
  popoverWidth: number,
  popoverHeight: number,
  gap: number
): Point {
  switch (edge) {
    case "left":
      return { x: Math.round(bar.x + bar.width + gap), y: Math.round(bar.y) };
    case "right":
      return { x: Math.round(bar.x - popoverWidth - gap), y: Math.round(bar.y) };
    case "top":
      return { x: Math.round(bar.x), y: Math.round(bar.y + bar.height + gap) };
    case "bottom":
    default:
      return { x: Math.round(bar.x), y: Math.round(bar.y - popoverHeight - gap) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/__tests__/utils/popoverPos.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/popoverPos.ts src/__tests__/utils/popoverPos.test.ts
git commit -m "feat(mini-bar): inward popover position math"
```

### Task 9: Peer button in MiniBar (reuses the peer-list window)

**Files:**
- Modify: `src/components/MiniBar.tsx`
- Modify: `src/hooks/useMiniMode.ts` (expose `edge`)
- Test: `src/__tests__/components/MiniBar.test.tsx`

- [ ] **Step 1: Expose the snapped `edge` from useMiniMode**

In `src/hooks/useMiniMode.ts`, add an `edge` state mirroring `orientation`:

- Add import: `type Edge` to the existing `from "../utils/snap"` import.
- Add state: `const [edge, setEdge] = useState<Edge>("bottom");`
- In `snapToNearest`, after `setOrientation(snap.orientation);` add `setEdge(snap.edge);`
- In the returned object add `edge`: `return { mode, orientation, edge, enterMini, exitMini, snapToNearest };`

- [ ] **Step 2: Write the failing test (append to MiniBar.test.tsx)**

```tsx
  it("renders a peer button that opens the peer-list popover", async () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" onRestore={() => {}} />);
    const btn = screen.getByTestId("mini-bar-action-lan");
    expect(btn).toBeInTheDocument();
  });
```

Also add `edge="bottom"` to the three existing MiniBar renders in this file (the prop is now required).

- [ ] **Step 3: Run to verify it fails**

Run: `bunx vitest run src/__tests__/components/MiniBar.test.tsx`
Expected: FAIL — no `mini-bar-action-lan`; TS error on missing `edge` prop.

- [ ] **Step 4: Update MiniBar**

Replace `src/components/MiniBar.tsx` with:

```tsx
import { useRef } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Status } from "../types/status";
import type { Orientation, Edge } from "../utils/snap";
import { inwardPopoverPos } from "../utils/popoverPos";
import "../styles/mini-bar.css";

/** Peer-list popover window size — must match tauri.conf.json. */
const PEER_W = 280;
const PEER_H = 260;
const POPOVER_GAP = 8;

interface MiniBarProps {
  status: Status;
  orientation: Orientation;
  edge: Edge;
  onRestore: () => void;
}

export function MiniBar({ status, orientation, edge, onRestore }: MiniBarProps) {
  const lanButtonRef = useRef<HTMLButtonElement>(null);

  const togglePeer = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const popover = await WebviewWindow.getByLabel("peer-list");
    if (!popover) return;
    if (await popover.isVisible()) {
      await popover.hide();
      return;
    }
    const main = getCurrentWindow();
    const sf = await main.scaleFactor();
    const pos = (await main.outerPosition()).toLogical(sf);
    const size = (await main.outerSize()).toLogical(sf);
    const p = inwardPopoverPos(
      { x: pos.x, y: pos.y, width: size.width, height: size.height },
      edge,
      PEER_W,
      PEER_H,
      POPOVER_GAP
    );
    await popover.setPosition(new LogicalPosition(p.x, p.y));
    await popover.show();
    await popover.setFocus();
  };

  return (
    <div
      data-testid="mini-bar"
      data-orientation={orientation}
      className={`mini-bar ${orientation} ${status}`}
    >
      <span data-testid="mini-bar-dot" className={`dot ${status}`} />

      <button
        ref={lanButtonRef}
        type="button"
        data-testid="mini-bar-action-lan"
        className="mini-bar-btn"
        aria-label="Mime Around You"
        title="Peers nearby"
        onClick={togglePeer}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2v3H5a1 1 0 0 0-1 1v1h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H6v-1h12v1h-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1h-2v-1a1 1 0 0 0-1-1h-6V9h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H9z" />
        </svg>
      </button>

      <button
        type="button"
        data-testid="mini-bar-restore"
        className="mini-bar-btn"
        aria-label="Restore pet"
        title="Restore"
        onClick={onRestore}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4h7v2H6v5H4V4zm9 0h7v7h-2V6h-5V4zM4 13h2v5h5v2H4v-7zm14 0h2v7h-7v-2h5v-5z" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Pass `edge` from App**

In `src/App.tsx`, update the `<MiniBar />` element to pass `edge={mini.edge}`.

- [ ] **Step 6: Add the webviewWindow mock alias (if not present)**

Check `vitest.config.ts` for a `@tauri-apps/api/webviewWindow` alias. If missing, add to the `alias` map:

```ts
      "@tauri-apps/api/webviewWindow": resolve(
        __dirname,
        "./src/__mocks__/tauri-webview-window.ts"
      ),
```

And create `src/__mocks__/tauri-webview-window.ts`:

```ts
export const WebviewWindow = {
  getByLabel: vi.fn(async (_label: string) => null),
};
```

(If `StatusPill.test.tsx` already passes today, the alias and a mock already exist — reuse it and skip this step.)

- [ ] **Step 7: Run the test + type-check**

Run: `npx tsc --noEmit && bunx vitest run src/__tests__/components/MiniBar.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/MiniBar.tsx src/hooks/useMiniMode.ts src/App.tsx vitest.config.ts src/__mocks__/tauri-webview-window.ts src/__tests__/components/MiniBar.test.tsx
git commit -m "feat(mini-bar): peer tool with edge-aware popover"
```

---

## Task Group 7: Session tool in the mini bar (extract dropdown + panel grow)

### Task 10: Extract session grouping into a util

**Files:**
- Create: `src/utils/sessionGroups.ts`
- Modify: `src/components/StatusPill.tsx`

- [ ] **Step 1: Create the util by moving pure helpers out of StatusPill**

Move these symbols **verbatim** from `src/components/StatusPill.tsx` into a new `src/utils/sessionGroups.ts` and `export` each: `statePriority`, `groupState`, `prettyPath`, `groupBasename`, `shellLabel`, the `Group` interface, `groupSessions`, `detectHome`, `reflectActiveServices`, `overlayClaudeState`. Add at the top:

```ts
import type { SessionInfo } from "../hooks/useSessions";
```

`src/utils/sessionGroups.ts` exports (signatures must match the originals exactly):

```ts
export const statePriority: Record<string, number>;
export function groupState(sessions: SessionInfo[]): string;
export function prettyPath(pwd: string, home?: string): string;
export function groupBasename(g: { pwd: string; pretty: string; sessions: SessionInfo[] }): string;
export function shellLabel(s: SessionInfo): string;
export interface Group { key: string; pwd: string; pretty: string; sessions: SessionInfo[]; state: string; isClaudeFallback: boolean; }
export function groupSessions(sessions: SessionInfo[], home?: string): Group[];
export function detectHome(sessions: SessionInfo[]): string | undefined;
export function reflectActiveServices(sessions: SessionInfo[]): SessionInfo[];
export function overlayClaudeState(sessions: SessionInfo[]): SessionInfo[];
```

- [ ] **Step 2: Update StatusPill to import them**

In `src/components/StatusPill.tsx`, delete the now-moved local definitions and add:

```tsx
import {
  groupSessions,
  detectHome,
  reflectActiveServices,
  overlayClaudeState,
  groupBasename,
  shellLabel,
  type Group,
} from "../utils/sessionGroups";
```

(Keep `SessionInfo` imported from `../hooks/useSessions` as today.)

- [ ] **Step 3: Type-check + run the suite**

Run: `npx tsc --noEmit && bunx vitest run`
Expected: tsc clean; all tests PASS (pure move, no behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/utils/sessionGroups.ts src/components/StatusPill.tsx
git commit -m "refactor(mini-bar): extract session grouping into sessionGroups util"
```

### Task 11: Extract the dropdown body into a shared SessionDropdown

**Files:**
- Create: `src/components/SessionDropdown.tsx`
- Modify: `src/components/StatusPill.tsx`

- [ ] **Step 1: Create SessionDropdown**

Create `src/components/SessionDropdown.tsx` holding the presentational dropdown. It receives the already-computed `groups` plus interaction callbacks (no data fetching inside):

```tsx
import { invoke } from "@tauri-apps/api/core";
import { groupBasename, shellLabel, type Group } from "../utils/sessionGroups";

interface SessionDropdownProps {
  groups: Group[];
  collapsed: Set<string>;
  toggleCollapsed: (key: string) => void;
  onPickSession: () => void;
  style?: React.CSSProperties;
  showPathTooltip: (el: HTMLElement, text: string) => void;
  hidePathTooltip: () => void;
}

export function SessionDropdown({
  groups,
  collapsed,
  toggleCollapsed,
  onPickSession,
  style,
  showPathTooltip,
  hidePathTooltip,
}: SessionDropdownProps) {
  return (
    <div
      data-testid="session-dropdown"
      className="session-dropdown"
      role="menu"
      style={style}
    >
      {groups.length === 0 ? (
        <div className="session-empty">No active terminals</div>
      ) : (
        groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          const headContent = (
            <>
              {!g.isClaudeFallback && (
                <span className="session-group-caret" aria-hidden="true" />
              )}
              <span className={`dot small ${g.state}`} />
              <span className="session-group-title-row">
                <span className="session-group-title">{groupBasename(g)}</span>
                {g.pretty && g.pretty !== groupBasename(g) && (
                  <span
                    className="session-group-info"
                    aria-label={`Full path: ${g.pretty}`}
                    onMouseEnter={(e) => showPathTooltip(e.currentTarget, g.pretty)}
                    onMouseLeave={hidePathTooltip}
                  >
                    ?
                  </span>
                )}
              </span>
            </>
          );
          return (
            <div
              key={g.key}
              className={`session-group ${g.isClaudeFallback ? "claude" : ""}`}
              data-testid={`session-group-${g.key}`}
            >
              {g.isClaudeFallback ? (
                <div className="session-group-head">{headContent}</div>
              ) : (
                <button
                  type="button"
                  className={`session-group-head clickable ${isCollapsed ? "collapsed" : ""}`}
                  data-testid={`session-group-head-${g.key}`}
                  aria-expanded={!isCollapsed}
                  aria-controls={`session-children-${g.key}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapsed(g.key);
                  }}
                >
                  {headContent}
                </button>
              )}

              {!g.isClaudeFallback && !isCollapsed && (
                <div className="session-children" id={`session-children-${g.key}`}>
                  {g.sessions.map((s) => (
                    <button
                      key={s.pid}
                      type="button"
                      className={`session-child ${s.has_claude ? "has-claude" : ""}`}
                      data-testid={`session-item-${s.pid}`}
                      title="Click to bring this terminal to the front"
                      onClick={(e) => {
                        e.stopPropagation();
                        invoke("focus_terminal", { pid: s.pid, tty: s.tty || null }).catch(
                          (err) => console.error("[focus_terminal]", err)
                        );
                        onPickSession();
                      }}
                    >
                      <span className={`dot small ${s.ui_state}`} />
                      <span className="session-child-label-row">
                        <span className="session-child-label">{shellLabel(s)}</span>
                        {s.has_claude && (
                          <span
                            className="session-child-claude"
                            aria-label="Claude Code running"
                          />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it in StatusPill**

In `src/components/StatusPill.tsx`, replace the inline `{sessionListEnabled && sessionOpen && (<div className="session-dropdown" ...>…</div>)}` block with:

```tsx
      {sessionListEnabled && sessionOpen && (
        <SessionDropdown
          groups={groups}
          collapsed={collapsed}
          toggleCollapsed={(key) => void toggleCollapsed(key)}
          onPickSession={() => setSessionOpen(false)}
          style={{ top: `${dropdownTop}px`, maxHeight: `${dropdownMaxHeight}px` }}
          showPathTooltip={showPathTooltip}
          hidePathTooltip={hidePathTooltip}
        />
      )}
```

Add the import: `import { SessionDropdown } from "./SessionDropdown";`

- [ ] **Step 3: Type-check + run the suite**

Run: `npx tsc --noEmit && bunx vitest run`
Expected: tsc clean; all tests PASS (StatusPill dropdown behavior unchanged — same testids).

- [ ] **Step 4: Commit**

```bash
git add src/components/SessionDropdown.tsx src/components/StatusPill.tsx
git commit -m "refactor(mini-bar): extract shared SessionDropdown component"
```

### Task 12: Session button + inward panel in MiniBar

**Files:**
- Modify: `src/components/MiniBar.tsx`
- Test: `src/__tests__/components/MiniBar.test.tsx`

- [ ] **Step 1: Write the failing test (append to MiniBar.test.tsx)**

```tsx
  it("renders a session button and opens the dropdown when clicked", async () => {
    render(<MiniBar status="idle" orientation="horizontal" edge="bottom" onRestore={() => {}} />);
    const btn = screen.getByTestId("mini-bar-action-task");
    fireEvent.click(btn);
    // dropdown appears after the async fetch resolves (mocked -> empty list)
    await screen.findByTestId("session-dropdown");
  });
```

Ensure the test imports `fireEvent` and that `fetchSessions` resolves (the `@tauri-apps/api/core` mock returns a default). If `invoke("get_sessions")` is not mocked to return an array, add to `src/__mocks__/tauri.ts` a default for `get_sessions` returning `[]`.

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run src/__tests__/components/MiniBar.test.tsx`
Expected: FAIL — no `mini-bar-action-task`.

- [ ] **Step 3: Add session state + button + inward panel to MiniBar**

Update `src/components/MiniBar.tsx`:

Add imports:

```tsx
import { useState, useEffect } from "react";
import { LogicalSize } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { fetchSessions } from "../hooks/useSessions";
import {
  groupSessions,
  detectHome,
  reflectActiveServices,
  overlayClaudeState,
  type Group,
} from "../utils/sessionGroups";
import { useSessionList } from "../hooks/useSessionList";
import { useCollapsedSessionGroups } from "../hooks/useCollapsedSessionGroups";
import { SessionDropdown } from "./SessionDropdown";
```

Add panel constants near the top:

```tsx
/** Mini-mode session panel size (logical px) when the list is open. */
const PANEL_W = 320;
const PANEL_LIST_H = 360;
```

Inside `MiniBar`, add state + the toggle + the window-grow effect:

```tsx
  const { enabled: sessionListEnabled } = useSessionList();
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();
  const [sessionOpen, setSessionOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  const toggleSession = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sessionListEnabled) return;
    if (sessionOpen) {
      setSessionOpen(false);
      return;
    }
    const list = await fetchSessions();
    setGroups(groupSessions(overlayClaudeState(reflectActiveServices(list)), detectHome(list)));
    setSessionOpen(true);
  };

  // Live refresh while open.
  useEffect(() => {
    if (!sessionOpen) return;
    let cancelled = false;
    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      setGroups(groupSessions(overlayClaudeState(reflectActiveServices(list)), detectHome(list)));
    };
    const unlistenP = listen("sessions-changed", () => void refresh());
    return () => {
      cancelled = true;
      unlistenP.then((fn) => fn());
    };
  }, [sessionOpen]);

  // Grow the bar window into a panel while the list is open.
  // On close, re-snap (which resizes the window back to the bar).
  useEffect(() => {
    if (!sessionOpen) {
      snapToNearest();
      return;
    }
    const vertical = orientation === "vertical";
    // Panel keeps the bar's thickness on its short axis and adds the list.
    const w = vertical ? PANEL_W : Math.max(PANEL_W, 168);
    const h = vertical ? PANEL_LIST_H : 40 + PANEL_LIST_H;
    void getCurrentWindow().setSize(new LogicalSize(w, h)).catch(() => {});
  }, [sessionOpen, orientation]); // eslint-disable-line react-hooks/exhaustive-deps
```

Add the session button (before the peer button) in the JSX:

```tsx
      {sessionListEnabled && (
        <button
          type="button"
          data-testid="mini-bar-action-task"
          className="mini-bar-btn"
          aria-label="Show sessions list"
          aria-expanded={sessionOpen}
          title="Session list"
          onClick={toggleSession}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 9h10v2H7V9zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" />
          </svg>
        </button>
      )}
```

Render the dropdown panel below the bar contents (inside the root `.mini-bar` div, after the buttons):

```tsx
      {sessionOpen && (
        <SessionDropdown
          groups={groups}
          collapsed={collapsed}
          toggleCollapsed={(key) => void toggleCollapsed(key)}
          onPickSession={() => setSessionOpen(false)}
          style={{ position: "static", maxHeight: `${PANEL_LIST_H}px`, width: "100%" }}
          showPathTooltip={() => {}}
          hidePathTooltip={() => {}}
        />
      )}
```

The close branch above calls `snapToNearest()` to resize the window back to the bar (App's `useWindowDefaultSize` stays paused in mini mode, so the bar can't shrink itself otherwise). Add `snapToNearest: () => void;` to `MiniBarProps` and destructure it alongside the other props.

- [ ] **Step 4: Pass `snapToNearest` from App**

In `src/App.tsx`, add `snapToNearest={mini.snapToNearest}` to the `<MiniBar />` element.

- [ ] **Step 5: Update existing MiniBar test renders**

Add `snapToNearest={() => {}}` to every `<MiniBar .../>` render in `src/__tests__/components/MiniBar.test.tsx`.

- [ ] **Step 6: Type-check + run the test**

Run: `npx tsc --noEmit && bunx vitest run src/__tests__/components/MiniBar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Manual smoke test**

Run: `bun run tauri dev`
Verify in mini mode: clicking the session button grows the bar into a panel showing the session list; picking a session focuses that terminal and closes the panel; the bar re-snaps to its edge. Clicking the peer button opens the peer popover inward from the bar's edge.

- [ ] **Step 8: Commit**

```bash
git add src/components/MiniBar.tsx src/App.tsx src/__tests__/components/MiniBar.test.tsx
git commit -m "feat(mini-bar): session list panel in mini mode"
```

---

## Task Group 8: End-to-end test

### Task 13: Playwright e2e for minimize → bar → restore

**Files:**
- Create: `e2e/mini-bar.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
// e2e/mini-bar.spec.ts
import { test, expect } from "@playwright/test";

test("minimize collapses the pet into a bar, restore brings it back", async ({ page }) => {
  await page.goto("/");
  // Enter mini mode.
  await page.getByTestId("pill-action-minimize").click();
  const bar = page.getByTestId("mini-bar");
  await expect(bar).toBeVisible();
  // Pet column is gone.
  await expect(page.getByTestId("status-pill")).toHaveCount(0);
  // Restore.
  await page.getByTestId("mini-bar-restore").click();
  await expect(page.getByTestId("status-pill")).toBeVisible();
  await expect(page.getByTestId("mini-bar")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the e2e**

Run: `bunx playwright test -c e2e/playwright.config.ts --project=chromium mini-bar`
Expected: PASS. (If the mini bar relies on `currentMonitor`, confirm `e2e/tauri-mock.ts` provides a window `currentMonitor` stub; if missing, add one returning `{ scaleFactor: 1, position: {x:0,y:0}, size: {width:1440,height:900} }` and the `outerSize`/`scaleFactor` window methods.)

- [ ] **Step 3: Commit**

```bash
git add e2e/mini-bar.spec.ts e2e/tauri-mock.ts
git commit -m "test(mini-bar): e2e for minimize/restore"
```

---

## Final Verification

- [ ] **Full type-check:** `npx tsc --noEmit` → clean.
- [ ] **Full unit suite:** `bunx vitest run` → all green.
- [ ] **E2e:** `bunx playwright test -c e2e/playwright.config.ts --project=chromium` → green.
- [ ] **Manual:** `bun run tauri dev` → minimize, drag to each of the 4 edges (verify vertical on left/right, horizontal on top/bottom), confirm glow tracks status, session + peer tools work in the bar, restore returns the pet to its prior spot.
- [ ] **Backend untouched:** no Rust changes were required (confirm `git diff --stat src-tauri` is empty).

---

## Notes & Risks (for the implementer)

- **`startDragging()` resolve timing (Task 5/7):** snapping fires when `startDragging()` resolves. The existing `useDrag` already relies on this resolve-on-release behavior. If snapping doesn't fire on some platform, add an `onMoved`-debounced re-snap in `useMiniMode` as a fallback (pattern exists in `StatusPill.tsx`'s `main.onMoved`).
- **`currentMonitor()` work area (Task 1/4):** Tauri doesn't expose dock/menubar insets, so we approximate with `DEFAULT_MARGINS` (top gets the larger `menuBar` margin). Acceptable for v1; refine later if the bar overlaps the menu bar/dock.
- **Session panel geometry (Task 12):** `PANEL_W`/`PANEL_LIST_H` are starting values; adjust during the manual smoke test so the panel reads well at each edge. This is the area most likely to need a visual tweak.
- **No persistence:** per the spec, the app always launches in pet mode; nothing is written to `settings.json`.
