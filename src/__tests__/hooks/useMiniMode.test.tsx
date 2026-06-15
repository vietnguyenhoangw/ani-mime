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
