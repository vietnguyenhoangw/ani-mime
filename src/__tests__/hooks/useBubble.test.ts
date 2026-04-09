import { renderHook, act } from "@testing-library/react";
import { useBubble } from "../../hooks/useBubble";
import { emitMockEvent } from "../../__mocks__/tauri-event";

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

    unmount();

    // Emit event after unmount — state should not change
    await act(async () => {
      emitMockEvent("task-completed", { duration_secs: 10 });
    });

    expect(result.current.visible).toBe(false);
  });
});
