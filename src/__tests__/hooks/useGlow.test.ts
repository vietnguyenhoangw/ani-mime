import { renderHook, act } from "@testing-library/react";
import { useGlow } from "../../hooks/useGlow";
import { mockStoreValue } from "../../__mocks__/tauri-store";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("useGlow", () => {
  it("defaults to light when store is empty", async () => {
    const { result } = renderHook(() => useGlow());
    await act(async () => {});

    // The hook initializes state to "light" and with no store value,
    // it stays "light" (no migration branch triggers either)
    expect(result.current.mode).toBe("light");
  });

  it("loads saved glowMode from store", async () => {
    mockStoreValue("settings.json", "glowMode", "dark");

    const { result } = renderHook(() => useGlow());
    await act(async () => {});

    expect(result.current.mode).toBe("dark");
  });

  it("migrates glowEnabled: true to light", async () => {
    mockStoreValue("settings.json", "glowEnabled", true);

    const { result } = renderHook(() => useGlow());
    await act(async () => {});

    expect(result.current.mode).toBe("light");
  });

  it("migrates glowEnabled: false to off", async () => {
    mockStoreValue("settings.json", "glowEnabled", false);

    const { result } = renderHook(() => useGlow());
    await act(async () => {});

    expect(result.current.mode).toBe("off");
  });

  it("prefers glowMode when both glowMode and glowEnabled exist", async () => {
    mockStoreValue("settings.json", "glowMode", "dark");
    mockStoreValue("settings.json", "glowEnabled", true);

    const { result } = renderHook(() => useGlow());
    await act(async () => {});

    expect(result.current.mode).toBe("dark");
  });

  it("setMode updates state", async () => {
    const { result } = renderHook(() => useGlow());
    await act(async () => {});

    await act(async () => {
      await result.current.setMode("dark");
    });

    expect(result.current.mode).toBe("dark");
  });

  it("updates when glow-changed event fires", async () => {
    const { result } = renderHook(() => useGlow());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("glow-changed", "off");
    });

    expect(result.current.mode).toBe("off");
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useGlow());
    await act(async () => {});

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith("glow-changed", expect.any(Function));

    await act(async () => {
      emitMockEvent("glow-changed", "dark");
    });
    expect(result.current.mode).toBe("dark");

    unmount();

    // Emit after unmount — state should not change
    await act(async () => {
      emitMockEvent("glow-changed", "off");
    });

    expect(result.current.mode).toBe("dark");
  });
});
