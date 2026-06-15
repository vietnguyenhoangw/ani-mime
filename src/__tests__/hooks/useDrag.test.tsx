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

  it("with requireHandle, only drags from a [data-drag-handle] element", async () => {
    const onDragEnd = vi.fn();
    const { result } = renderHook(() =>
      useDrag(onDragEnd, { requireHandle: true })
    );

    // Press on a plain element inside the bar — must NOT drag.
    const plain = document.createElement("div");
    await act(async () => {
      await result.current.onMouseDown(mouseEvent(plain));
    });
    expect(getCurrentWindow().startDragging).not.toHaveBeenCalled();

    // Press on the drag handle — must drag and re-snap.
    const handle = document.createElement("span");
    handle.setAttribute("data-drag-handle", "");
    await act(async () => {
      await result.current.onMouseDown(mouseEvent(handle));
    });
    expect(getCurrentWindow().startDragging).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
