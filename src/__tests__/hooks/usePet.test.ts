import { renderHook, act } from "@testing-library/react";
import { usePet } from "../../hooks/usePet";
import { mockStoreValue, getMockStore } from "../../__mocks__/tauri-store";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("usePet", () => {
  it("defaults to rottweiler", async () => {
    const { result } = renderHook(() => usePet());
    await act(async () => {});

    expect(result.current.pet).toBe("rottweiler");
  });

  it("loads saved pet from store", async () => {
    mockStoreValue("settings.json", "pet", "dalmatian");

    const { result } = renderHook(() => usePet());
    await act(async () => {});

    expect(result.current.pet).toBe("dalmatian");
    expect(result.current.loaded).toBe(true);
  });

  it("updates pet via setPet", async () => {
    const { result } = renderHook(() => usePet());
    await act(async () => {});

    await act(async () => {
      await result.current.setPet("samurai");
    });

    expect(result.current.pet).toBe("samurai");

    // Verify store persistence
    const store = getMockStore("settings.json");
    expect(store!.set).toHaveBeenCalledWith("pet", "samurai");
    expect(store!.save).toHaveBeenCalled();
  });

  it("updates when pet-changed event fires", async () => {
    const { result } = renderHook(() => usePet());
    await act(async () => {});

    await act(async () => {
      emitMockEvent("pet-changed", "hancock");
    });

    expect(result.current.pet).toBe("hancock");
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => usePet());
    await act(async () => {});

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith("pet-changed", expect.any(Function));

    await act(async () => {
      emitMockEvent("pet-changed", "hancock");
    });
    expect(result.current.pet).toBe("hancock");

    unmount();

    // Emit after unmount — state should not change
    await act(async () => {
      emitMockEvent("pet-changed", "dalmatian");
    });

    expect(result.current.pet).toBe("hancock");
  });
});
