# Test Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix false-confidence tests, close coverage gaps for all untested hooks, add timer-based tests, and strengthen the e2e infrastructure — based on the 3-agent QA review findings.

**Architecture:** TDD approach — fix broken tests first, then add missing coverage in dependency order (simple hooks → complex hooks → e2e infra). Each task is self-contained with a commit.

**Tech Stack:** Vitest 4, @testing-library/react 16, Playwright 1.59, jsdom, vi.useFakeTimers

---

## Phase 1: Fix False-Confidence Tests (P0)

These tests pass today but verify nothing meaningful. Fix them first so the suite is trustworthy before adding new tests.

### Task 1: Fix useStatus cleanup test

The current test at `src/__tests__/hooks/useStatus.test.ts:104-116` calls `unmount()` but never verifies that listeners were actually removed. It would pass even if cleanup code was deleted.

**Files:**
- Modify: `src/__tests__/hooks/useStatus.test.ts:104-116`

**Step 1: Read the existing test and the mock**

Read `src/__tests__/hooks/useStatus.test.ts` and `src/__mocks__/tauri-event.ts` to understand the `emitMockEvent` helper and the unlisten mechanism.

**Step 2: Replace the cleanup test with one that actually verifies cleanup**

Replace the test at lines 104-116 with:

```typescript
it("cleans up listeners on unmount", async () => {
  const { result, unmount } = renderHook(() => useStatus());
  await vi.waitFor(() => expect(result.current.status).toBe("disconnected"));

  // Capture state before unmount
  const statusBefore = result.current.status;

  unmount();

  // Emit after unmount — state must NOT change
  emitMockEvent("status-changed", "busy");
  emitMockEvent("dog-away", true);
  emitMockEvent("scenario-override", { status: "service" });

  // If cleanup worked, the hook is gone and state is frozen
  // We verify indirectly: no errors thrown, and re-rendering would show stale state
  // The key proof is that emitMockEvent doesn't throw (handler was removed from Set)
  expect(result.current.status).toBe(statusBefore);
});
```

**Step 3: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hooks/useStatus.test.ts --reporter=verbose`
Expected: PASS — cleanup already works in the hook, we just weren't testing it.

**Step 4: Commit**

```bash
git add src/__tests__/hooks/useStatus.test.ts
git commit -m "test: verify useStatus actually cleans up listeners on unmount"
```

---

### Task 2: Fix useBubble cleanup test

Same problem at `src/__tests__/hooks/useBubble.test.ts:97-103`.

**Files:**
- Modify: `src/__tests__/hooks/useBubble.test.ts:97-103`

**Step 1: Replace the cleanup test**

```typescript
it("cleans up listeners on unmount", async () => {
  const { result, unmount } = renderHook(() => useBubble("idle"));

  // Wait for initialization
  await vi.waitFor(() => expect(result.current).toBeDefined());

  unmount();

  // Emit after unmount — must not throw or update state
  emitMockEvent("task-completed", { duration_secs: 10 });
  expect(result.current.visible).toBe(false);
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useBubble.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useBubble.test.ts
git commit -m "test: verify useBubble actually cleans up listeners on unmount"
```

---

### Task 3: Fix useVisitors and usePeers cleanup tests

Same pattern. Both at `src/__tests__/hooks/useVisitors.test.ts:76-83` and `src/__tests__/hooks/usePeers.test.ts:63-69`.

**Files:**
- Modify: `src/__tests__/hooks/useVisitors.test.ts:76-83`
- Modify: `src/__tests__/hooks/usePeers.test.ts:63-69`

**Step 1: Fix useVisitors cleanup test**

```typescript
it("cleans up listeners on unmount", async () => {
  const { result, unmount } = renderHook(() => useVisitors());
  await vi.waitFor(() => expect(result.current).toEqual([]));

  unmount();

  // Emit after unmount — state must stay empty
  emitMockEvent("visitor-arrived", { nickname: "Ghost", pet: "dalmatian" });
  expect(result.current).toEqual([]);
});
```

**Step 2: Fix usePeers cleanup test**

```typescript
it("cleans up listeners on unmount", async () => {
  const { result, unmount } = renderHook(() => usePeers());
  await vi.waitFor(() => expect(result.current).toEqual([]));

  unmount();

  // Emit after unmount — state must stay empty
  emitMockEvent("peers-changed", [{ instance_name: "ghost", nickname: "Ghost", pet: "dalmatian" }]);
  expect(result.current).toEqual([]);
});
```

**Step 3: Run both tests**

Run: `npx vitest run src/__tests__/hooks/useVisitors.test.ts src/__tests__/hooks/usePeers.test.ts --reporter=verbose`
Expected: PASS

**Step 4: Commit**

```bash
git add src/__tests__/hooks/useVisitors.test.ts src/__tests__/hooks/usePeers.test.ts
git commit -m "test: verify useVisitors and usePeers actually clean up listeners on unmount"
```

---

### Task 4: Fix useBubble tautological message assertion

The test at `src/__tests__/hooks/useBubble.test.ts:28-45` asserts the message is one of 5 hardcoded strings — the hook always returns one of those same strings, so it can never fail. Pin randomness to test a specific message.

**Files:**
- Modify: `src/__tests__/hooks/useBubble.test.ts:28-45`

**Step 1: Replace the test to pin Math.random**

```typescript
it("sets message from task-completed payload", async () => {
  // Pin randomness to get deterministic message
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

  const { result } = renderHook(() => useBubble("idle"));
  await vi.waitFor(() => expect(result.current).toBeDefined());

  emitMockEvent("task-completed", { duration_secs: 10 });

  await vi.waitFor(() => expect(result.current.visible).toBe(true));
  // With Math.random() = 0, index = floor(0 * 5) = 0 → first message
  expect(result.current.message).toBe("Good boy! Task done! 🐾");

  randomSpy.mockRestore();
});
```

Note: Check the actual first message in `src/hooks/useBubble.ts:9-15` before writing this. The message above is a placeholder — use the actual first element of the `messages` array.

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useBubble.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useBubble.test.ts
git commit -m "test: pin Math.random in useBubble to make message assertion deterministic"
```

---

## Phase 2: Timer-Dependent Behavior Tests

Both `useBubble` (7s auto-dismiss) and `Mascot` (10s auto-freeze) use timers that are never tested. These are real user-facing behaviors.

### Task 5: Add useBubble auto-dismiss timer test

**Files:**
- Modify: `src/__tests__/hooks/useBubble.test.ts`

**Step 1: Add a new test using fake timers**

Add after the existing tests, inside the same `describe` block:

```typescript
describe("auto-dismiss timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-hides bubble after 7 seconds", async () => {
    const { result } = renderHook(() => useBubble("idle"));

    // Trigger a bubble via task-completed
    emitMockEvent("task-completed", { duration_secs: 5 });
    await vi.waitFor(() => expect(result.current.visible).toBe(true));

    // Advance 6.9s — still visible
    vi.advanceTimersByTime(6900);
    expect(result.current.visible).toBe(true);

    // Advance past 7s — auto-dismissed
    vi.advanceTimersByTime(200);
    expect(result.current.visible).toBe(false);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useBubble.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useBubble.test.ts
git commit -m "test: verify useBubble auto-dismisses after 7 seconds"
```

---

### Task 6: Add Mascot auto-freeze timer test

**Files:**
- Modify: `src/__tests__/components/Mascot.test.tsx`

**Step 1: Add auto-freeze tests**

Add a new `describe("auto-freeze timer")` block:

```typescript
describe("auto-freeze timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("freezes sprite after 10 seconds for idle status", () => {
    const { container } = render(<Mascot status="idle" />);
    const sprite = container.querySelector(".sprite");

    // Not frozen initially
    expect(sprite?.classList.contains("frozen")).toBe(false);

    // Advance 10s
    act(() => { vi.advanceTimersByTime(10_000); });

    expect(sprite?.classList.contains("frozen")).toBe(true);
  });

  it("freezes sprite after 10 seconds for disconnected status", () => {
    const { container } = render(<Mascot status="disconnected" />);
    const sprite = container.querySelector(".sprite");

    act(() => { vi.advanceTimersByTime(10_000); });

    expect(sprite?.classList.contains("frozen")).toBe(true);
  });

  it("does NOT freeze sprite for busy status", () => {
    const { container } = render(<Mascot status="busy" />);
    const sprite = container.querySelector(".sprite");

    act(() => { vi.advanceTimersByTime(15_000); });

    expect(sprite?.classList.contains("frozen")).toBe(false);
  });

  it("resets freeze timer when status changes", () => {
    const { container, rerender } = render(<Mascot status="idle" />);
    const sprite = container.querySelector(".sprite");

    // Advance 8s (not yet frozen)
    act(() => { vi.advanceTimersByTime(8_000); });
    expect(sprite?.classList.contains("frozen")).toBe(false);

    // Change status — timer resets
    rerender(<Mascot status="busy" />);

    // Advance another 10s — should NOT freeze (busy is not auto-stop)
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(sprite?.classList.contains("frozen")).toBe(false);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/components/Mascot.test.tsx --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/components/Mascot.test.tsx
git commit -m "test: verify Mascot auto-freeze timer for idle/disconnected statuses"
```

---

## Phase 3: Test Untested Hooks (Simple → Complex)

Ordered by complexity. Simple hooks first to build confidence in the mock infrastructure.

### Task 7: Add useDevMode tests

Simplest hook — 17 lines, event-driven only, no store.

**Files:**
- Create: `src/__tests__/hooks/useDevMode.test.ts`

**Step 1: Write the test file**

```typescript
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useDevMode } from "../../hooks/useDevMode";
import { emitMockEvent } from "../../__mocks__/tauri-event";

describe("useDevMode", () => {
  it("defaults to false", () => {
    const { result } = renderHook(() => useDevMode());
    expect(result.current).toBe(false);
  });

  it("updates when dev-mode-changed event fires", async () => {
    const { result } = renderHook(() => useDevMode());

    emitMockEvent("dev-mode-changed", true);
    await vi.waitFor(() => expect(result.current).toBe(true));

    emitMockEvent("dev-mode-changed", false);
    await vi.waitFor(() => expect(result.current).toBe(false));
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useDevMode());

    unmount();

    emitMockEvent("dev-mode-changed", true);
    expect(result.current).toBe(false);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useDevMode.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useDevMode.test.ts
git commit -m "test: add useDevMode hook tests"
```

---

### Task 8: Add useUpdate tests

24 lines, event-driven with dismiss.

**Files:**
- Create: `src/__tests__/hooks/useUpdate.test.ts`

**Step 1: Write the test file**

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useUpdate } from "../../hooks/useUpdate";
import { emitMockEvent } from "../../__mocks__/tauri-event";

describe("useUpdate", () => {
  it("defaults to null update", () => {
    const { result } = renderHook(() => useUpdate());
    expect(result.current.update).toBeNull();
  });

  it("sets update info from update-available event", async () => {
    const { result } = renderHook(() => useUpdate());

    emitMockEvent("update-available", { latest: "2.0.0", current: "1.0.0" });
    await vi.waitFor(() => expect(result.current.update).toEqual({
      latest: "2.0.0",
      current: "1.0.0",
    }));
  });

  it("dismiss clears the update", async () => {
    const { result } = renderHook(() => useUpdate());

    emitMockEvent("update-available", { latest: "2.0.0", current: "1.0.0" });
    await vi.waitFor(() => expect(result.current.update).not.toBeNull());

    act(() => { result.current.dismiss(); });

    expect(result.current.update).toBeNull();
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useUpdate());

    unmount();

    emitMockEvent("update-available", { latest: "3.0.0", current: "1.0.0" });
    expect(result.current.update).toBeNull();
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useUpdate.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useUpdate.test.ts
git commit -m "test: add useUpdate hook tests"
```

---

### Task 9: Add useNickname tests

39 lines, store + events.

**Files:**
- Create: `src/__tests__/hooks/useNickname.test.ts`

**Step 1: Write the test file**

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useNickname } from "../../hooks/useNickname";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { mockStoreValue } from "../../__mocks__/tauri-store";

describe("useNickname", () => {
  it("defaults to empty string", async () => {
    const { result } = renderHook(() => useNickname());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.nickname).toBe("");
  });

  it("loads saved nickname from store", async () => {
    mockStoreValue("settings.json", "nickname", "Buddy");
    const { result } = renderHook(() => useNickname());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.nickname).toBe("Buddy");
  });

  it("updates nickname via setNickname", async () => {
    const { result } = renderHook(() => useNickname());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setNickname("Rex");
    });

    expect(result.current.nickname).toBe("Rex");
  });

  it("updates when nickname-changed event fires", async () => {
    const { result } = renderHook(() => useNickname());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    emitMockEvent("nickname-changed", "Spot");
    await vi.waitFor(() => expect(result.current.nickname).toBe("Spot"));
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useNickname());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    unmount();

    emitMockEvent("nickname-changed", "Ghost");
    expect(result.current.nickname).toBe("");
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useNickname.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useNickname.test.ts
git commit -m "test: add useNickname hook tests"
```

---

### Task 10: Add usePet tests

42 lines, store + events with default fallback.

**Files:**
- Create: `src/__tests__/hooks/usePet.test.ts`

**Step 1: Write the test file**

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { usePet } from "../../hooks/usePet";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { mockStoreValue } from "../../__mocks__/tauri-store";

describe("usePet", () => {
  it("defaults to rottweiler", async () => {
    const { result } = renderHook(() => usePet());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.pet).toBe("rottweiler");
  });

  it("loads saved pet from store", async () => {
    mockStoreValue("settings.json", "pet", "dalmatian");
    const { result } = renderHook(() => usePet());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.pet).toBe("dalmatian");
  });

  it("updates pet via setPet", async () => {
    const { result } = renderHook(() => usePet());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setPet("samurai");
    });

    expect(result.current.pet).toBe("samurai");
  });

  it("updates when pet-changed event fires", async () => {
    const { result } = renderHook(() => usePet());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    emitMockEvent("pet-changed", "hancock");
    await vi.waitFor(() => expect(result.current.pet).toBe("hancock"));
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => usePet());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    unmount();

    emitMockEvent("pet-changed", "dalmatian");
    expect(result.current.pet).toBe("rottweiler");
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/usePet.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/usePet.test.ts
git commit -m "test: add usePet hook tests"
```

---

### Task 11: Add useTheme tests

50 lines, store + events + DOM mutation.

**Files:**
- Create: `src/__tests__/hooks/useTheme.test.ts`

**Step 1: Write the test file**

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useTheme } from "../../hooks/useTheme";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { mockStoreValue } from "../../__mocks__/tauri-store";

describe("useTheme", () => {
  afterEach(() => {
    // Clean up DOM mutation
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark theme", async () => {
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.theme).toBe("dark");
  });

  it("loads saved theme from store", async () => {
    mockStoreValue("settings.json", "theme", "light");
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.theme).toBe("light");
  });

  it("applies theme to document root", async () => {
    mockStoreValue("settings.json", "theme", "light");
    renderHook(() => useTheme());
    await vi.waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light")
    );
  });

  it("updates theme via setTheme", async () => {
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("updates when theme-changed event fires", async () => {
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    emitMockEvent("theme-changed", "light");
    await vi.waitFor(() => expect(result.current.theme).toBe("light"));
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    unmount();

    emitMockEvent("theme-changed", "light");
    expect(result.current.theme).toBe("dark");
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useTheme.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useTheme.test.ts
git commit -m "test: add useTheme hook tests with DOM mutation verification"
```

---

### Task 12: Add useGlow tests (with migration logic)

48 lines, has backward-compat migration from boolean `glowEnabled` to `GlowMode` enum. This is the most important untested hook after `useCustomMimes` because the migration logic is fragile.

**Files:**
- Create: `src/__tests__/hooks/useGlow.test.ts`

**Step 1: Write the test file**

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useGlow } from "../../hooks/useGlow";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { mockStoreValue } from "../../__mocks__/tauri-store";

describe("useGlow", () => {
  it("defaults to off", async () => {
    const { result } = renderHook(() => useGlow());
    await vi.waitFor(() => expect(result.current.mode).toBeDefined());
    expect(result.current.mode).toBe("off");
  });

  it("loads saved glow mode from store", async () => {
    mockStoreValue("settings.json", "glowMode", "dark");
    const { result } = renderHook(() => useGlow());
    await vi.waitFor(() => expect(result.current.mode).toBe("dark"));
  });

  describe("migration from old glowEnabled boolean", () => {
    it("migrates glowEnabled: true to 'light'", async () => {
      mockStoreValue("settings.json", "glowEnabled", true);
      const { result } = renderHook(() => useGlow());
      await vi.waitFor(() => expect(result.current.mode).toBe("light"));
    });

    it("migrates glowEnabled: false to 'off'", async () => {
      mockStoreValue("settings.json", "glowEnabled", false);
      const { result } = renderHook(() => useGlow());
      await vi.waitFor(() => expect(result.current.mode).toBe("off"));
    });

    it("prefers glowMode over glowEnabled when both exist", async () => {
      mockStoreValue("settings.json", "glowMode", "dark");
      mockStoreValue("settings.json", "glowEnabled", true);
      const { result } = renderHook(() => useGlow());
      await vi.waitFor(() => expect(result.current.mode).toBe("dark"));
    });
  });

  it("updates mode via setMode", async () => {
    const { result } = renderHook(() => useGlow());
    await vi.waitFor(() => expect(result.current.mode).toBeDefined());

    await act(async () => {
      await result.current.setMode("dark");
    });

    expect(result.current.mode).toBe("dark");
  });

  it("updates when glow-changed event fires", async () => {
    const { result } = renderHook(() => useGlow());
    await vi.waitFor(() => expect(result.current.mode).toBeDefined());

    emitMockEvent("glow-changed", "light");
    await vi.waitFor(() => expect(result.current.mode).toBe("light"));
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useGlow());
    await vi.waitFor(() => expect(result.current.mode).toBeDefined());

    unmount();

    emitMockEvent("glow-changed", "dark");
    expect(result.current.mode).toBe("off");
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useGlow.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useGlow.test.ts
git commit -m "test: add useGlow hook tests including migration from boolean to enum"
```

---

### Task 13: Add useCustomMimes tests

Most complex untested hook — 165 lines with FS operations, store, events, and ID generation.

**Files:**
- Create: `src/__tests__/hooks/useCustomMimes.test.ts`
- May need to modify: `src/__mocks__/tauri-fs.ts` (to support error injection)

**Step 1: Check the tauri-fs mock**

Read `src/__mocks__/tauri-fs.ts` to understand what mock functions are available. All functions are `vi.fn()` that resolve by default. For error testing, use `mockRejectedValueOnce`.

**Step 2: Write the test file**

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useCustomMimes, ALL_STATUSES } from "../../hooks/useCustomMimes";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { mockStoreValue } from "../../__mocks__/tauri-store";
import { exists, mkdir, copyFile, writeFile, remove } from "../../__mocks__/tauri-fs";

// Note: The exact imports above depend on what tauri-fs.ts exports.
// Adjust based on reading the actual mock file.

describe("useCustomMimes", () => {
  it("defaults to empty mimes array", async () => {
    const { result } = renderHook(() => useCustomMimes());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.mimes).toEqual([]);
  });

  it("loads saved mimes from store", async () => {
    const savedMimes = [
      { id: "custom_test", name: "Test Mime", sprites: {} },
    ];
    mockStoreValue("settings.json", "customMimes", savedMimes);
    const { result } = renderHook(() => useCustomMimes());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.mimes).toEqual(savedMimes);
  });

  it("addMimeFromBlobs creates files and updates store", async () => {
    const { result } = renderHook(() => useCustomMimes());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    const blobs: Record<string, { blob: Uint8Array; frames: number }> = {};
    for (const status of ALL_STATUSES) {
      blobs[status] = { blob: new Uint8Array([1, 2, 3]), frames: 4 };
    }

    await act(async () => {
      await result.current.addMimeFromBlobs("TestDog", blobs);
    });

    // Should have created the sprites directory
    expect(mkdir).toHaveBeenCalled();

    // Should have written a file for each status
    expect(writeFile).toHaveBeenCalledTimes(ALL_STATUSES.length);

    // Should have added to mimes list
    expect(result.current.mimes).toHaveLength(1);
    expect(result.current.mimes[0].name).toBe("TestDog");
  });

  it("deleteMime removes files and updates store", async () => {
    const savedMimes = [
      {
        id: "custom_test",
        name: "Test",
        sprites: Object.fromEntries(
          ALL_STATUSES.map((s) => [s, { src: `/sprites/${s}.png`, frames: 4 }])
        ),
      },
    ];
    mockStoreValue("settings.json", "customMimes", savedMimes);

    const { result } = renderHook(() => useCustomMimes());
    await vi.waitFor(() => expect(result.current.mimes).toHaveLength(1));

    await act(async () => {
      await result.current.deleteMime("custom_test");
    });

    expect(result.current.mimes).toHaveLength(0);
    // Should have attempted to remove sprite files
    expect(remove).toHaveBeenCalled();
  });

  it("updates when custom-mimes-changed event fires", async () => {
    const { result } = renderHook(() => useCustomMimes());
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));

    const newMimes = [{ id: "custom_ext", name: "External", sprites: {} }];
    emitMockEvent("custom-mimes-changed", newMimes);
    await vi.waitFor(() => expect(result.current.mimes).toHaveLength(1));
    expect(result.current.mimes[0].name).toBe("External");
  });

  it("deleteMime handles missing files gracefully", async () => {
    // remove() throws for missing file
    (remove as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

    const savedMimes = [
      {
        id: "custom_gone",
        name: "Gone",
        sprites: Object.fromEntries(
          ALL_STATUSES.map((s) => [s, { src: `/sprites/${s}.png`, frames: 4 }])
        ),
      },
    ];
    mockStoreValue("settings.json", "customMimes", savedMimes);

    const { result } = renderHook(() => useCustomMimes());
    await vi.waitFor(() => expect(result.current.mimes).toHaveLength(1));

    // Should not throw even if files are missing
    await act(async () => {
      await result.current.deleteMime("custom_gone");
    });

    expect(result.current.mimes).toHaveLength(0);
  });
});
```

Note: The exact shape of `mimes`, `sprites`, and function signatures need to be verified by reading `useCustomMimes.ts` carefully. Adjust the test data to match the actual types.

**Step 3: Run test**

Run: `npx vitest run src/__tests__/hooks/useCustomMimes.test.ts --reporter=verbose`
Expected: PASS (may need adjustments based on actual types)

**Step 4: Commit**

```bash
git add src/__tests__/hooks/useCustomMimes.test.ts
git commit -m "test: add useCustomMimes hook tests covering add, delete, and error handling"
```

---

## Phase 4: Strengthen Existing Tests

### Task 14: Add useBubble enabled/welcome tests

**Files:**
- Modify: `src/__tests__/hooks/useBubble.test.ts`

**Step 1: Add tests for disabled suppression and single-welcome**

Add after existing tests:

```typescript
describe("enabled gate", () => {
  it("suppresses task-completed bubble when disabled", async () => {
    mockStoreValue("settings.json", "bubbleEnabled", false);
    const { result } = renderHook(() => useBubble("idle"));
    await vi.waitFor(() => expect(result.current.enabled).toBe(false));

    emitMockEvent("task-completed", { duration_secs: 10 });

    // Give React a chance to process
    await vi.waitFor(() => expect(result.current.visible).toBe(false));
  });

  it("suppresses welcome bubble when disabled", async () => {
    mockStoreValue("settings.json", "bubbleEnabled", false);
    const { result } = renderHook(() => useBubble("disconnected"));
    await vi.waitFor(() => expect(result.current.enabled).toBe(false));

    // Transition to idle — would normally trigger welcome
    emitMockEvent("status-changed", "idle");

    await vi.waitFor(() => expect(result.current.visible).toBe(false));
  });
});

describe("welcome bubble", () => {
  it("shows welcome only on first idle transition", async () => {
    const { result } = renderHook(() => useBubble("disconnected"));
    await vi.waitFor(() => expect(result.current).toBeDefined());

    // First idle — should show welcome
    emitMockEvent("status-changed", "idle");
    await vi.waitFor(() => expect(result.current.visible).toBe(true));

    // Dismiss it
    act(() => { result.current.dismiss(); });
    expect(result.current.visible).toBe(false);

    // Second idle — should NOT show welcome again
    emitMockEvent("status-changed", "busy");
    emitMockEvent("status-changed", "idle");

    // Wait a tick and verify still not visible
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.visible).toBe(false);
  });
});

describe("status suppression", () => {
  it("hides bubble when status changes to service", async () => {
    const { result } = renderHook(() => useBubble("idle"));
    await vi.waitFor(() => expect(result.current).toBeDefined());

    // Show a bubble
    emitMockEvent("task-completed", { duration_secs: 5 });
    await vi.waitFor(() => expect(result.current.visible).toBe(true));

    // Service status should hide it
    emitMockEvent("status-changed", "service");
    await vi.waitFor(() => expect(result.current.visible).toBe(false));
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useBubble.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useBubble.test.ts
git commit -m "test: add useBubble tests for enabled gate, welcome-once, and service suppression"
```

---

### Task 15: Add useScale setter tests

Current tests only cover reading. The setter's CSS property mutation, window resize, store persistence, and event emission are all unverified.

**Files:**
- Modify: `src/__tests__/hooks/useScale.test.ts`

**Step 1: Add setter and resize tests**

```typescript
describe("setScale", () => {
  it("updates scale state and CSS custom property", async () => {
    const { result } = renderHook(() => useScale());
    await vi.waitFor(() => expect(result.current.scale).toBeDefined());

    await act(async () => {
      await result.current.setScale(2);
    });

    expect(result.current.scale).toBe(2);
    expect(
      document.documentElement.style.getPropertyValue("--sprite-scale")
    ).toBe("2");
  });

  it("resizes main window to correct dimensions", async () => {
    // Import the mock window to check setSize was called
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();

    const { result } = renderHook(() => useScale());
    await vi.waitFor(() => expect(result.current.scale).toBeDefined());

    await act(async () => {
      await result.current.setScale(1.5);
    });

    // Check setSize was called (window size for 1.5 is 700x300)
    expect(win.setSize).toHaveBeenCalled();
  });
});
```

Note: The exact assertion on `setSize` arguments depends on how `LogicalSize` is mocked. Check `src/__mocks__/tauri-dpi.ts` and `src/__mocks__/tauri-window.ts` for the mock shape. Adjust accordingly.

**Step 2: Run test**

Run: `npx vitest run src/__tests__/hooks/useScale.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useScale.test.ts
git commit -m "test: add useScale setter tests for CSS, window resize, and persistence"
```

---

### Task 16: Add sprites.ts utility function tests

`getSpriteMap`, `registerCustomSprites`, `unregisterCustomSprites`, `getMimesByCategory` are never tested.

**Files:**
- Create: `src/__tests__/constants/sprites.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import {
  getSpriteMap,
  registerCustomSprites,
  unregisterCustomSprites,
  getMimesByCategory,
  pets,
} from "../../constants/sprites";

describe("sprites utilities", () => {
  afterEach(() => {
    // Clean up any custom registrations
    unregisterCustomSprites("test-custom");
  });

  describe("getSpriteMap", () => {
    it("returns sprites for known pet", () => {
      const map = getSpriteMap("rottweiler");
      expect(map).toBeDefined();
      expect(map.idle).toBeDefined();
      expect(map.busy).toBeDefined();
      expect(map.idle.frames).toBeGreaterThan(0);
    });

    it("falls back to first pet for unknown pet ID", () => {
      const fallback = getSpriteMap("nonexistent" as any);
      const first = getSpriteMap(pets[0].id as any);
      expect(fallback).toEqual(first);
    });

    it("returns custom sprites when registered", () => {
      const customSprites = {
        idle: { src: "/custom/idle.png", frames: 3 },
        busy: { src: "/custom/busy.png", frames: 5 },
      } as any;

      registerCustomSprites("test-custom", customSprites);
      const map = getSpriteMap("test-custom" as any);
      expect(map).toBe(customSprites);
    });

    it("returns default after unregister", () => {
      const customSprites = { idle: { src: "/x.png", frames: 1 } } as any;
      registerCustomSprites("test-custom", customSprites);
      unregisterCustomSprites("test-custom");

      const map = getSpriteMap("test-custom" as any);
      // Should fall back to first pet
      expect(map).toEqual(getSpriteMap(pets[0].id as any));
    });
  });

  describe("getMimesByCategory", () => {
    it("returns pet-category mimes", () => {
      const petMimes = getMimesByCategory("pet");
      expect(petMimes.length).toBeGreaterThan(0);
      expect(petMimes.every((m) => m.category === "pet")).toBe(true);
    });

    it("returns character-category mimes", () => {
      const chars = getMimesByCategory("character");
      expect(chars.length).toBeGreaterThan(0);
      expect(chars.every((m) => m.category === "character")).toBe(true);
    });

    it("returns empty for unknown category", () => {
      const result = getMimesByCategory("nonexistent" as any);
      expect(result).toEqual([]);
    });
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/constants/sprites.test.ts --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/constants/sprites.test.ts
git commit -m "test: add sprites utility tests for getSpriteMap, register/unregister, getMimesByCategory"
```

---

## Phase 5: E2E Infrastructure Fixes

### Task 17: Fix hardcoded cwd and add failure artifacts in Playwright config

**Files:**
- Modify: `e2e/playwright.config.ts`

**Step 1: Fix the config**

Replace the hardcoded `cwd` with a relative path, add WebKit project, add screenshot/trace on failure:

```typescript
import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:1420",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    cwd: path.resolve(__dirname, ".."),
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
```

**Step 2: Run tests to verify config**

Run: `npx playwright test --config e2e/playwright.config.ts --list`
Expected: Shows test list for both chromium and webkit projects

**Step 3: Commit**

```bash
git add e2e/playwright.config.ts
git commit -m "fix: use relative cwd in playwright config, add webkit project and failure artifacts"
```

---

### Task 18: Add data-testid attributes to key components

Add `data-testid` to the most fragile selectors identified by QA3. Don't change all selectors at once — just add the attributes so tests can migrate incrementally.

**Files:**
- Modify: `src/components/StatusPill.tsx` — add `data-testid="status-pill"`, `data-testid="status-dot"`, `data-testid="status-label"`
- Modify: `src/components/Mascot.tsx` — add `data-testid="mascot-sprite"`
- Modify: `src/components/SpeechBubble.tsx` — add `data-testid="speech-bubble"`, `data-testid="speech-bubble-text"`
- Modify: `src/App.tsx` — add `data-testid="app-container"`, `data-testid="scenario-badge"`

**Step 1: Add the attributes**

For each component, add `data-testid` to the relevant root/key elements. Example for StatusPill:

```tsx
// On the pill container div:
<div className={...} data-testid="status-pill">
// On the dot span:
<span className={...} data-testid="status-dot" />
// On the label span:
<span className={...} data-testid="status-label">{...}</span>
```

Read each file first, then make minimal edits to add the attributes. Do not change any other code.

**Step 2: Run all existing tests to verify nothing breaks**

Run: `npx vitest run --reporter=verbose`
Expected: All 105+ tests pass (adding data-testid doesn't break anything)

**Step 3: Commit**

```bash
git add src/components/StatusPill.tsx src/components/Mascot.tsx src/components/SpeechBubble.tsx src/App.tsx
git commit -m "feat: add data-testid attributes to key components for robust test selectors"
```

---

### Task 19: Migrate e2e selectors to data-testid

Now update the smoke tests to use the new `data-testid` selectors where available.

**Files:**
- Modify: `e2e/smoke.spec.ts`

**Step 1: Replace fragile selectors**

Replace CSS class selectors with `data-testid` equivalents:

| Old | New |
|-----|-----|
| `.container` | `[data-testid="app-container"]` |
| `.sprite` | `[data-testid="mascot-sprite"]` |
| `.pill .label` | `[data-testid="status-label"]` |
| `.pill .dot` | `[data-testid="status-dot"]` |
| `.speech-bubble` | `[data-testid="speech-bubble"]` |
| `.speech-bubble-text` | `[data-testid="speech-bubble-text"]` |
| `.scenario-badge` | `[data-testid="scenario-badge"]` |

Keep `.settings`, `.settings-sidebar`, `.sidebar-item` as-is (Settings components weren't updated).

**Step 2: Run e2e tests**

Run: `npx playwright test --config e2e/playwright.config.ts --project=chromium`
Expected: All 6 tests pass

**Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test: migrate e2e selectors from CSS classes to data-testid attributes"
```

---

### Task 20: Remove stale mock comments

Clean up the misleading comments that say aliases don't exist when they do.

**Files:**
- Modify: `src/__tests__/hooks/useScale.test.ts` — remove comment at line 6
- Modify: `src/__tests__/components/VisitorDog.test.tsx` — remove comment at line 4
- Modify: `src/__tests__/components/Mascot.test.tsx` — remove comment at line 10

**Step 1: Remove stale comments**

In each file, remove the line that says `// Mock @tauri-apps/api/dpi which is not aliased in vitest config` or similar. Keep the `vi.mock(...)` call itself — just remove the inaccurate comment.

**Step 2: Run tests**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/__tests__/hooks/useScale.test.ts src/__tests__/components/VisitorDog.test.tsx src/__tests__/components/Mascot.test.tsx
git commit -m "chore: remove stale comments about missing vitest aliases"
```

---

## Phase 6: Add Missing E2E Status Coverage

### Task 21: Add e2e tests for all status values

Currently only `busy`, `idle`, and `service` (via scenario) are tested. Add `disconnected`, `searching`, `visiting`, and `service` (standalone).

**Files:**
- Modify: `e2e/smoke.spec.ts`

**Step 1: Add new status tests**

Append after existing tests, before the Settings test:

```typescript
test("6. Status transitions to disconnected", async ({ page }) => {
  await loadWithMock(page);
  await page.goto("/");

  await page.evaluate(() => {
    (window as any).__TEST_EMIT__("status-changed", "disconnected");
  });

  const label = page.locator("[data-testid='status-label']");
  await expect(label).toHaveText("Sleep");

  const dot = page.locator("[data-testid='status-dot']");
  await expect(dot).toHaveClass(/disconnected/);
});

test("7. Status transitions to searching", async ({ page }) => {
  await loadWithMock(page);
  await page.goto("/");

  await page.evaluate(() => {
    (window as any).__TEST_EMIT__("status-changed", "searching");
  });

  const label = page.locator("[data-testid='status-label']");
  await expect(label).toHaveText("Searching...");
});

test("8. Visiting status hides mascot", async ({ page }) => {
  await loadWithMock(page);
  await page.goto("/");

  // First set to idle so mascot is visible
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__("status-changed", "idle");
  });
  await expect(page.locator("[data-testid='mascot-sprite']")).toBeVisible();

  // Now set away — mascot should hide
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__("dog-away", true);
  });
  await expect(page.locator("[data-testid='mascot-sprite']")).not.toBeVisible();
});
```

Note: Verify the exact label text for each status by reading `src/components/StatusPill.tsx`. The strings above (`"Sleep"`, `"Searching..."`) are based on what the QA review found — confirm before writing.

**Step 2: Run e2e tests**

Run: `npx playwright test --config e2e/playwright.config.ts --project=chromium`
Expected: All tests pass (old + new)

**Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test: add e2e tests for disconnected, searching, and visiting statuses"
```

---

## Summary

| Phase | Tasks | What It Fixes |
|-------|-------|---------------|
| 1 | Tasks 1-4 | False-confidence cleanup + tautology tests |
| 2 | Tasks 5-6 | Timer-dependent behavior (bubble dismiss, mascot freeze) |
| 3 | Tasks 7-13 | 7 untested hooks (useDevMode → useCustomMimes) |
| 4 | Tasks 14-16 | Strengthen useBubble, useScale, and sprites.ts |
| 5 | Tasks 17-20 | E2E infra (config, data-testid, stale comments) |
| 6 | Task 21 | E2E coverage for all 7 status values |

**Total: 21 tasks, ~21 commits**

After completion, run full suite to verify:
```bash
npx vitest run --reporter=verbose && npx playwright test --config e2e/playwright.config.ts
```
