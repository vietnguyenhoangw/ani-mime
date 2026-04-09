import { renderHook, act } from "@testing-library/react";
import { useDevMode } from "../../hooks/useDevMode";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("useDevMode", () => {
  it("defaults to false", () => {
    const { result } = renderHook(() => useDevMode());
    expect(result.current).toBe(false);
  });

  it("updates to true on dev-mode-changed event", async () => {
    const { result } = renderHook(() => useDevMode());

    await act(async () => {
      emitMockEvent("dev-mode-changed", true);
    });

    expect(result.current).toBe(true);
  });

  it("updates to false on dev-mode-changed event", async () => {
    const { result } = renderHook(() => useDevMode());

    await act(async () => {
      emitMockEvent("dev-mode-changed", true);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      emitMockEvent("dev-mode-changed", false);
    });
    expect(result.current).toBe(false);
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useDevMode());

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(
      "dev-mode-changed",
      expect.any(Function)
    );

    await act(async () => {
      emitMockEvent("dev-mode-changed", true);
    });
    expect(result.current).toBe(true);

    unmount();

    // Emit after unmount — state should not change
    await act(async () => {
      emitMockEvent("dev-mode-changed", false);
    });

    expect(result.current).toBe(true);
  });
});
