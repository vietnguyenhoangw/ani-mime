import { renderHook, act } from "@testing-library/react";
import { useVisitors } from "../../hooks/useVisitors";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("useVisitors", () => {
  it("returns empty array initially", () => {
    const { result } = renderHook(() => useVisitors());
    expect(result.current).toEqual([]);
  });

  it("adds visitor on 'visitor-arrived' event", async () => {
    const { result } = renderHook(() => useVisitors());

    await act(async () => {
      emitMockEvent("visitor-arrived", {
        pet: "dalmatian",
        nickname: "Buddy",
        duration_secs: 30,
      });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toEqual({
      pet: "dalmatian",
      nickname: "Buddy",
      duration_secs: 30,
    });
  });

  it("adds multiple visitors", async () => {
    const { result } = renderHook(() => useVisitors());

    await act(async () => {
      emitMockEvent("visitor-arrived", {
        pet: "dalmatian",
        nickname: "Buddy",
        duration_secs: 30,
      });
      emitMockEvent("visitor-arrived", {
        pet: "rottweiler",
        nickname: "Rex",
        duration_secs: 60,
      });
    });

    expect(result.current).toHaveLength(2);
  });

  it("removes visitor on 'visitor-left' event", async () => {
    const { result } = renderHook(() => useVisitors());

    await act(async () => {
      emitMockEvent("visitor-arrived", {
        pet: "dalmatian",
        nickname: "Buddy",
        duration_secs: 30,
      });
      emitMockEvent("visitor-arrived", {
        pet: "rottweiler",
        nickname: "Rex",
        duration_secs: 60,
      });
    });

    expect(result.current).toHaveLength(2);

    await act(async () => {
      emitMockEvent("visitor-left", { nickname: "Buddy" });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].nickname).toBe("Rex");
  });

  it("cleans up listeners on unmount", async () => {
    const { result, unmount } = renderHook(() => useVisitors());

    expect(listen).toHaveBeenCalledWith("visitor-arrived", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("visitor-left", expect.any(Function));

    unmount();

    // Emit event after unmount — state should not change
    await act(async () => {
      emitMockEvent("visitor-arrived", { nickname: "Ghost", pet: "dalmatian", duration_secs: 30 });
    });

    expect(result.current).toEqual([]);
  });
});
