import { renderHook, act } from "@testing-library/react";
import { useUpdate } from "../../hooks/useUpdate";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("useUpdate", () => {
  it("defaults to null update", () => {
    const { result } = renderHook(() => useUpdate());
    expect(result.current.update).toBeNull();
  });

  it("sets update info from update-available event", async () => {
    const { result } = renderHook(() => useUpdate());

    await act(async () => {
      emitMockEvent("update-available", {
        latest: "2.0.0",
        current: "1.0.0",
      });
    });

    expect(result.current.update).toEqual({
      latest: "2.0.0",
      current: "1.0.0",
    });
  });

  it("dismiss() clears the update back to null", async () => {
    const { result } = renderHook(() => useUpdate());

    await act(async () => {
      emitMockEvent("update-available", {
        latest: "2.0.0",
        current: "1.0.0",
      });
    });
    expect(result.current.update).not.toBeNull();

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.update).toBeNull();
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useUpdate());

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(
      "update-available",
      expect.any(Function)
    );

    await act(async () => {
      emitMockEvent("update-available", {
        latest: "2.0.0",
        current: "1.0.0",
      });
    });
    expect(result.current.update).not.toBeNull();

    unmount();

    // Emit after unmount — state should not change
    await act(async () => {
      emitMockEvent("update-available", {
        latest: "3.0.0",
        current: "1.0.0",
      });
    });

    expect(result.current.update).toEqual({
      latest: "2.0.0",
      current: "1.0.0",
    });
  });
});
