import { renderHook, act } from "@testing-library/react";
import { useCustomMimes, ALL_STATUSES } from "../../hooks/useCustomMimes";
import { mockStoreValue } from "../../__mocks__/tauri-store";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";
import { mkdir, writeFile, remove, exists } from "@tauri-apps/plugin-fs";
import type { CustomMimeData } from "../../types/status";

/** Helper: build a full sprites record for all statuses */
function makeSpriteRecord(
  prefix: string
): CustomMimeData["sprites"] {
  const sprites: Record<string, { fileName: string; frames: number }> = {};
  for (const status of ALL_STATUSES) {
    sprites[status] = { fileName: `${prefix}-${status}.png`, frames: 4 };
  }
  return sprites as CustomMimeData["sprites"];
}

/** Helper: build a complete CustomMimeData */
function makeMime(id: string, name: string): CustomMimeData {
  return { id, name, sprites: makeSpriteRecord(id) };
}

/** Helper: build blobs record for addMimeFromBlobs */
function makeBlobsRecord(): Record<
  string,
  { blob: Uint8Array; frames: number }
> {
  const blobs: Record<string, { blob: Uint8Array; frames: number }> = {};
  for (const status of ALL_STATUSES) {
    blobs[status] = { blob: new Uint8Array([1, 2, 3]), frames: 4 };
  }
  return blobs;
}

describe("useCustomMimes", () => {
  it("defaults to empty mimes array", async () => {
    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toEqual([]);
    expect(result.current.loaded).toBe(true);
  });

  it("loads saved mimes from store", async () => {
    const saved = [makeMime("custom-111", "TestMime")];
    mockStoreValue("settings.json", "customMimes", saved);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toEqual(saved);
    expect(result.current.loaded).toBe(true);
  });

  it("addMimeFromBlobs creates sprite files and updates mimes list", async () => {
    // exists returns false so mkdir is called
    vi.mocked(exists).mockResolvedValue(false);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    let returnedId: string | undefined;
    await act(async () => {
      returnedId = await result.current.addMimeFromBlobs(
        "BlobMime",
        makeBlobsRecord() as any
      );
    });

    // mkdir was called to ensure sprites directory
    expect(mkdir).toHaveBeenCalledWith(
      "/mock/app-data/custom-sprites",
      { recursive: true }
    );

    // writeFile was called once for each status
    expect(writeFile).toHaveBeenCalledTimes(ALL_STATUSES.length);

    // Each call writes to the correct path pattern
    for (const call of vi.mocked(writeFile).mock.calls) {
      expect(call[0]).toMatch(/^\/mock\/app-data\/custom-sprites\/custom-\d+-\w+\.png$/);
      expect(call[1]).toBeInstanceOf(Uint8Array);
    }

    // State updated with new mime
    expect(result.current.mimes).toHaveLength(1);
    expect(result.current.mimes[0].name).toBe("BlobMime");
    expect(returnedId).toBeDefined();
    expect(returnedId).toMatch(/^custom-\d+$/);

    // All statuses have sprite entries
    for (const status of ALL_STATUSES) {
      expect(result.current.mimes[0].sprites[status]).toBeDefined();
      expect(result.current.mimes[0].sprites[status].frames).toBe(4);
    }
  });

  it("deleteMime removes from list", async () => {
    const mime = makeMime("custom-222", "ToDelete");
    mockStoreValue("settings.json", "customMimes", [mime]);

    // exists returns true so mkdir is not called
    vi.mocked(exists).mockResolvedValue(true);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toHaveLength(1);

    await act(async () => {
      await result.current.deleteMime("custom-222");
    });

    // remove was called for each status sprite
    expect(remove).toHaveBeenCalledTimes(ALL_STATUSES.length);

    expect(result.current.mimes).toHaveLength(0);
  });

  it("deleteMime handles missing files gracefully", async () => {
    const mime = makeMime("custom-333", "MissingFiles");
    mockStoreValue("settings.json", "customMimes", [mime]);

    vi.mocked(exists).mockResolvedValue(true);
    // Simulate file not found on remove
    vi.mocked(remove).mockRejectedValue(new Error("file not found"));

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    // Should not throw
    await act(async () => {
      await result.current.deleteMime("custom-333");
    });

    // Still removed from the list despite file errors
    expect(result.current.mimes).toHaveLength(0);
  });

  it("updates when custom-mimes-changed event fires", async () => {
    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toEqual([]);

    const eventMimes = [makeMime("custom-444", "EventMime")];
    await act(async () => {
      emitMockEvent("custom-mimes-changed", eventMimes);
    });

    expect(result.current.mimes).toEqual(eventMimes);
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useCustomMimes());
    await act(async () => {});

    // useCustomMimes registers a listener for custom-mimes-changed
    expect(listen).toHaveBeenCalledWith(
      "custom-mimes-changed",
      expect.any(Function)
    );

    const eventMimes = [makeMime("custom-555", "BeforeUnmount")];
    await act(async () => {
      emitMockEvent("custom-mimes-changed", eventMimes);
    });
    expect(result.current.mimes).toEqual(eventMimes);

    unmount();

    // Emit after unmount — state should not change
    const afterMimes = [makeMime("custom-666", "AfterUnmount")];
    await act(async () => {
      emitMockEvent("custom-mimes-changed", afterMimes);
    });

    expect(result.current.mimes).toEqual(eventMimes);
  });
});
