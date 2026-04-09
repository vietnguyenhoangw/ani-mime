import { renderHook, act } from "@testing-library/react";
import { useScale } from "../../hooks/useScale";
import { mockStoreValue } from "../../__mocks__/tauri-store";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { getCurrentWindow } from "../../__mocks__/tauri-window";

describe("useScale", () => {
  it("returns default scale of 1", async () => {
    const { result } = renderHook(() => useScale());

    // Wait for useLayoutEffect
    await act(async () => {});

    expect(result.current.scale).toBe(1);
  });

  it("loads saved scale from store", async () => {
    mockStoreValue("settings.json", "displayScale", 2);

    const { result } = renderHook(() => useScale());
    await act(async () => {});

    expect(result.current.scale).toBe(2);
  });

  it("falls back to 1 for invalid saved scale", async () => {
    mockStoreValue("settings.json", "displayScale", 3);

    const { result } = renderHook(() => useScale());
    await act(async () => {});

    expect(result.current.scale).toBe(1);
  });

  it("updates scale on scale-changed event", async () => {
    const { result } = renderHook(() => useScale());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("scale-changed", 1.5);
    });

    expect(result.current.scale).toBe(1.5);
  });

  it("exposes SCALE_PRESETS", () => {
    const { result } = renderHook(() => useScale());
    expect(result.current.SCALE_PRESETS).toEqual([0.5, 1, 1.5, 2]);
  });

  describe("setScale", () => {
    afterEach(() => {
      document.documentElement.style.removeProperty("--sprite-scale");
    });

    it("updates state to the new scale value", async () => {
      const { result } = renderHook(() => useScale());
      await act(async () => {});

      await act(async () => {
        await result.current.setScale(2);
      });

      expect(result.current.scale).toBe(2);
    });

    it("sets CSS custom property --sprite-scale on document.documentElement", async () => {
      const { result } = renderHook(() => useScale());
      await act(async () => {});

      await act(async () => {
        await result.current.setScale(2);
      });

      expect(document.documentElement.style.getPropertyValue("--sprite-scale")).toBe("2");
    });

    it("calls win.setSize with correct LogicalSize", async () => {
      const { result } = renderHook(() => useScale());
      await act(async () => {});

      const mockWin = getCurrentWindow();
      mockWin.setSize.mockClear();

      await act(async () => {
        await result.current.setScale(1.5);
      });

      expect(mockWin.setSize).toHaveBeenCalledTimes(1);
      const sizeArg = mockWin.setSize.mock.calls[0][0];
      expect(sizeArg.width).toBe(700);
      expect(sizeArg.height).toBe(300);
    });
  });
});
