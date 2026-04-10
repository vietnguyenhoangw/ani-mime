import { renderHook, act } from "@testing-library/react";
import { useBubble } from "../../hooks/useBubble";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { mockStoreValue } from "../../__mocks__/tauri-store";

describe("useBubble", () => {
  it("starts not visible", async () => {
    const { result } = renderHook(() => useBubble());

    // Wait for useLayoutEffect store load to settle
    await act(async () => {});

    expect(result.current.visible).toBe(false);
    expect(result.current.message).toBe("");
  });

  it("becomes visible on task-completed event", async () => {
    const { result } = renderHook(() => useBubble());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("task-completed", { duration_secs: 5 });
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.message).toBeTruthy();
  });

  it("sets message from task-completed payload", async () => {
    // Pin Math.random so message selection is deterministic (index 0)
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    const { result } = renderHook(() => useBubble());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("task-completed", { duration_secs: 10 });
    });

    // With Math.random() === 0, Math.floor(0 * 5) === 0 → first message
    expect(result.current.message).toBe("Done! Check it out");

    randomSpy.mockRestore();
  });

  it("dismiss() hides bubble", async () => {
    const { result } = renderHook(() => useBubble());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("task-completed", { duration_secs: 5 });
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.visible).toBe(false);
  });

  it("hides bubble when status changes to busy", async () => {
    const { result } = renderHook(() => useBubble());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("task-completed", { duration_secs: 5 });
    });
    expect(result.current.visible).toBe(true);

    await act(async () => {
      emitMockEvent("status-changed", "busy");
    });

    expect(result.current.visible).toBe(false);
  });

  it("shows welcome bubble on first idle status", async () => {
    const { result } = renderHook(() => useBubble());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("status-changed", "idle");
    });

    expect(result.current.visible).toBe(true);
    const welcomeMessages = [
      "Hey! Ready to work",
      "Let's get started!",
      "Hello there!",
      "Woof! Hi!",
    ];
    expect(welcomeMessages).toContain(result.current.message);
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useBubble());
    await act(async () => {});

    // Make bubble visible before unmount
    await act(async () => {
      emitMockEvent("task-completed", { duration_secs: 5 });
    });
    expect(result.current.visible).toBe(true);

    unmount();

    // Emit event after unmount — state should stay at pre-unmount value
    await act(async () => {
      emitMockEvent("task-completed", { duration_secs: 10 });
    });

    expect(result.current.visible).toBe(true);
  });

  describe("auto-dismiss timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-hides bubble after BUBBLE_DURATION_MS (7000ms)", async () => {
      const { result } = renderHook(() => useBubble());
      await act(async () => {});

      // Trigger a bubble via task-completed
      await act(async () => {
        emitMockEvent("task-completed", { duration_secs: 5 });
      });
      expect(result.current.visible).toBe(true);

      // At 6900ms the bubble should still be visible
      act(() => {
        vi.advanceTimersByTime(6900);
      });
      expect(result.current.visible).toBe(true);

      // At 7000ms total the bubble should auto-hide
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current.visible).toBe(false);
    });
  });

  describe("enabled gate", () => {
    it("suppresses task-completed bubble when bubbleEnabled is false", async () => {
      mockStoreValue("settings.json", "bubbleEnabled", false);

      const { result } = renderHook(() => useBubble());
      await act(async () => {});

      expect(result.current.enabled).toBe(false);

      await act(async () => {
        emitMockEvent("task-completed", { duration_secs: 5 });
      });

      expect(result.current.visible).toBe(false);
    });

    it("suppresses welcome bubble when bubbleEnabled is false", async () => {
      mockStoreValue("settings.json", "bubbleEnabled", false);

      const { result } = renderHook(() => useBubble());
      await act(async () => {});

      expect(result.current.enabled).toBe(false);

      await act(async () => {
        emitMockEvent("status-changed", "idle");
      });

      expect(result.current.visible).toBe(false);
    });
  });

  describe("welcome shows only once", () => {
    it("does not show welcome again after dismiss and re-idle", async () => {
      const { result } = renderHook(() => useBubble());
      await act(async () => {});

      // First idle → welcome shows
      await act(async () => {
        emitMockEvent("status-changed", "idle");
      });
      expect(result.current.visible).toBe(true);

      // Dismiss the welcome bubble
      act(() => {
        result.current.dismiss();
      });
      expect(result.current.visible).toBe(false);

      // Transition away from idle
      await act(async () => {
        emitMockEvent("status-changed", "busy");
      });

      // Transition back to idle → should NOT show welcome again
      await act(async () => {
        emitMockEvent("status-changed", "idle");
      });
      expect(result.current.visible).toBe(false);
    });
  });

  describe("service status hides bubble", () => {
    it("hides bubble when status changes to service", async () => {
      const { result } = renderHook(() => useBubble());
      await act(async () => {});

      // Show a bubble via task-completed
      await act(async () => {
        emitMockEvent("task-completed", { duration_secs: 5 });
      });
      expect(result.current.visible).toBe(true);

      // Emit service status
      await act(async () => {
        emitMockEvent("status-changed", "service");
      });

      expect(result.current.visible).toBe(false);
    });
  });
});
