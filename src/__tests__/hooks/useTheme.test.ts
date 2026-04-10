import { renderHook, act } from "@testing-library/react";
import { useTheme } from "../../hooks/useTheme";
import { mockStoreValue, getMockStore } from "../../__mocks__/tauri-store";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("useTheme", () => {
  it("defaults to dark theme", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    expect(result.current.theme).toBe("dark");
  });

  it("loads saved theme from store", async () => {
    mockStoreValue("settings.json", "theme", "light");

    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    expect(result.current.theme).toBe("light");
    expect(result.current.loaded).toBe(true);
  });

  it("applies theme to document.documentElement via data-theme attribute", async () => {
    mockStoreValue("settings.json", "theme", "light");

    renderHook(() => useTheme());
    await act(async () => {});

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("applies dark theme to DOM by default", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    expect(result.current.loaded).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("setTheme updates state AND DOM attribute", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    await act(async () => {
      await result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    // Verify store persistence
    const store = getMockStore("settings.json");
    expect(store!.set).toHaveBeenCalledWith("theme", "light");
    expect(store!.save).toHaveBeenCalled();
  });

  it("updates when theme-changed event fires", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("theme-changed", "light");
    });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useTheme());
    await act(async () => {});

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith("theme-changed", expect.any(Function));

    await act(async () => {
      emitMockEvent("theme-changed", "light");
    });
    expect(result.current.theme).toBe("light");

    unmount();

    // Emit after unmount — state should not change
    await act(async () => {
      emitMockEvent("theme-changed", "dark");
    });

    expect(result.current.theme).toBe("light");
  });
});
