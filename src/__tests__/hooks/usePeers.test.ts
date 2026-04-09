import { renderHook, act } from "@testing-library/react";
import { usePeers } from "../../hooks/usePeers";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("usePeers", () => {
  it("returns empty array initially", () => {
    const { result } = renderHook(() => usePeers());
    expect(result.current).toEqual([]);
  });

  it("updates on 'peers-changed' event", async () => {
    const { result } = renderHook(() => usePeers());

    const peers = [
      {
        instance_name: "peer-1",
        nickname: "Alice",
        pet: "dalmatian",
        ip: "192.168.1.10",
        port: 1234,
      },
      {
        instance_name: "peer-2",
        nickname: "Bob",
        pet: "rottweiler",
        ip: "192.168.1.11",
        port: 1234,
      },
    ];

    await act(async () => {
      emitMockEvent("peers-changed", peers);
    });

    expect(result.current).toHaveLength(2);
    expect(result.current[0].nickname).toBe("Alice");
    expect(result.current[1].nickname).toBe("Bob");
  });

  it("replaces entire peer list on update", async () => {
    const { result } = renderHook(() => usePeers());

    await act(async () => {
      emitMockEvent("peers-changed", [
        {
          instance_name: "peer-1",
          nickname: "Alice",
          pet: "dalmatian",
          ip: "192.168.1.10",
          port: 1234,
        },
      ]);
    });
    expect(result.current).toHaveLength(1);

    await act(async () => {
      emitMockEvent("peers-changed", []);
    });
    expect(result.current).toHaveLength(0);
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => usePeers());

    expect(listen).toHaveBeenCalledWith("peers-changed", expect.any(Function));

    unmount();

    // Emit event after unmount — state should not change
    await act(async () => {
      emitMockEvent("peers-changed", [{ instance_name: "ghost", nickname: "Ghost", pet: "dalmatian", ip: "192.168.1.99", port: 1234 }]);
    });

    expect(result.current).toEqual([]);
  });
});
