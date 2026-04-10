import { renderHook, act } from "@testing-library/react";
import { useNickname } from "../../hooks/useNickname";
import { mockStoreValue, getMockStore } from "../../__mocks__/tauri-store";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("useNickname", () => {
  it("defaults to empty string", async () => {
    const { result } = renderHook(() => useNickname());
    await act(async () => {});

    expect(result.current.nickname).toBe("");
  });

  it("loads saved nickname from store", async () => {
    mockStoreValue("settings.json", "nickname", "Buddy");

    const { result } = renderHook(() => useNickname());
    await act(async () => {});

    expect(result.current.nickname).toBe("Buddy");
    expect(result.current.loaded).toBe(true);
  });

  it("updates nickname via setNickname", async () => {
    const { result } = renderHook(() => useNickname());
    await act(async () => {});

    await act(async () => {
      await result.current.setNickname("Rex");
    });

    expect(result.current.nickname).toBe("Rex");

    // Verify store persistence
    const store = getMockStore("settings.json");
    expect(store!.set).toHaveBeenCalledWith("nickname", "Rex");
    expect(store!.save).toHaveBeenCalled();
  });

  it("updates when nickname-changed event fires", async () => {
    const { result } = renderHook(() => useNickname());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("nickname-changed", "Spot");
    });

    expect(result.current.nickname).toBe("Spot");
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useNickname());
    await act(async () => {});

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(
      "nickname-changed",
      expect.any(Function)
    );

    await act(async () => {
      emitMockEvent("nickname-changed", "Fido");
    });
    expect(result.current.nickname).toBe("Fido");

    unmount();

    // Emit after unmount — state should not change
    await act(async () => {
      emitMockEvent("nickname-changed", "Max");
    });

    expect(result.current.nickname).toBe("Fido");
  });
});
