import { renderHook, act } from "@testing-library/react";
import { useStatus } from "../../hooks/useStatus";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("useStatus", () => {
  it("returns 'initializing' initially", () => {
    const { result } = renderHook(() => useStatus());
    expect(result.current.status).toBe("initializing");
    expect(result.current.scenario).toBe(false);
  });

  it("updates status on 'status-changed' event", async () => {
    const { result } = renderHook(() => useStatus());

    await act(async () => {
      emitMockEvent("status-changed", "busy");
    });

    expect(result.current.status).toBe("busy");
    expect(result.current.scenario).toBe(false);
  });

  it("ignores invalid status values", async () => {
    const { result } = renderHook(() => useStatus());

    await act(async () => {
      emitMockEvent("status-changed", "invalid-status");
    });

    expect(result.current.status).toBe("initializing");
  });

  it("returns 'visiting' when dog-away event is true", async () => {
    const { result } = renderHook(() => useStatus());

    await act(async () => {
      emitMockEvent("status-changed", "idle");
    });
    expect(result.current.status).toBe("idle");

    await act(async () => {
      emitMockEvent("dog-away", true);
    });

    expect(result.current.status).toBe("visiting");
  });

  it("returns original status when dog-away is false", async () => {
    const { result } = renderHook(() => useStatus());

    await act(async () => {
      emitMockEvent("status-changed", "idle");
      emitMockEvent("dog-away", true);
    });
    expect(result.current.status).toBe("visiting");

    await act(async () => {
      emitMockEvent("dog-away", false);
    });

    expect(result.current.status).toBe("idle");
  });

  it("returns scenario status on 'scenario-override' event", async () => {
    const { result } = renderHook(() => useStatus());

    await act(async () => {
      emitMockEvent("scenario-override", { status: "busy" });
    });

    expect(result.current.status).toBe("busy");
    expect(result.current.scenario).toBe(true);
  });

  it("scenario flag is true when scenario active", async () => {
    const { result } = renderHook(() => useStatus());

    expect(result.current.scenario).toBe(false);

    await act(async () => {
      emitMockEvent("scenario-override", { status: "service" });
    });

    expect(result.current.scenario).toBe(true);
  });

  it("clears scenario on null payload", async () => {
    const { result } = renderHook(() => useStatus());

    await act(async () => {
      emitMockEvent("scenario-override", { status: "busy" });
    });
    expect(result.current.scenario).toBe(true);

    await act(async () => {
      emitMockEvent("scenario-override", null);
    });

    expect(result.current.scenario).toBe(false);
    expect(result.current.status).toBe("initializing");
  });

  it("cleans up listeners on unmount", async () => {
    const { result, unmount } = renderHook(() => useStatus());

    // listen was called 3 times (status-changed, dog-away, scenario-override)
    expect(listen).toHaveBeenCalledTimes(3);
    expect(listen).toHaveBeenCalledWith("status-changed", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("dog-away", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("scenario-override", expect.any(Function));

    const statusBeforeUnmount = result.current.status;
    unmount();

    // Emit events after unmount — state should not change
    await act(async () => {
      emitMockEvent("status-changed", "busy");
      emitMockEvent("dog-away", true);
      emitMockEvent("scenario-override", { status: "service" });
    });

    expect(result.current.status).toBe(statusBeforeUnmount);
  });
});
