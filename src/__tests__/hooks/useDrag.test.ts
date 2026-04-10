import { renderHook, act } from "@testing-library/react";
import { useDrag } from "../../hooks/useDrag";
import { getCurrentWindow } from "@tauri-apps/api/window";

describe("useDrag", () => {
  it("dragging starts false", () => {
    const { result } = renderHook(() => useDrag());
    expect(result.current.dragging).toBe(false);
  });

  it("onMouseDown triggers Tauri startDragging for left click", async () => {
    const { result } = renderHook(() => useDrag());
    const mockWindow = getCurrentWindow();

    await act(async () => {
      await result.current.onMouseDown({
        button: 0,
      } as React.MouseEvent);
    });

    expect(mockWindow.startDragging).toHaveBeenCalledTimes(1);
  });

  it("onMouseDown ignores non-left clicks", async () => {
    const { result } = renderHook(() => useDrag());
    const mockWindow = getCurrentWindow();

    await act(async () => {
      await result.current.onMouseDown({
        button: 2,
      } as React.MouseEvent);
    });

    expect(mockWindow.startDragging).not.toHaveBeenCalled();
  });

  it("dragging resets to false after startDragging resolves", async () => {
    const { result } = renderHook(() => useDrag());

    await act(async () => {
      await result.current.onMouseDown({
        button: 0,
      } as React.MouseEvent);
    });

    // After await, dragging should be false again
    expect(result.current.dragging).toBe(false);
  });
});
