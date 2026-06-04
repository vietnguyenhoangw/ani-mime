import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useQuickClose } from "../../hooks/useQuickClose";
import { getCurrentWindow } from "@tauri-apps/api/window";

describe("useQuickClose", () => {
  it("hides the window on Cmd+W", () => {
    renderHook(() => useQuickClose());
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    expect(getCurrentWindow().hide).toHaveBeenCalledTimes(1);
  });

  it("hides the window on Ctrl+W", () => {
    renderHook(() => useQuickClose());
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(getCurrentWindow().hide).toHaveBeenCalledTimes(1);
  });

  it("ignores plain 'w' without a modifier", () => {
    renderHook(() => useQuickClose());
    fireEvent.keyDown(window, { key: "w" });
    expect(getCurrentWindow().hide).not.toHaveBeenCalled();
  });

  it("ignores other modified keys", () => {
    renderHook(() => useQuickClose());
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(getCurrentWindow().hide).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const { unmount } = renderHook(() => useQuickClose());
    unmount();
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    expect(getCurrentWindow().hide).not.toHaveBeenCalled();
  });
});
