import { renderHook, act, waitFor } from "@testing-library/react";
import { usePlugins } from "../../hooks/usePlugins";
import { mockInvoke } from "../../__mocks__/tauri";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { invoke } from "@tauri-apps/api/core";
import type { PluginRecord } from "../../types/plugin";

function rec(id: string, enabled = true): PluginRecord {
  return {
    manifest: {
      id,
      name: id,
      version: "0.1.0",
      description: "",
      author: "",
      entry: "index.html",
      capabilities: ["window"],
      window: { width: 100, height: 100, resizable: false, alwaysOnTop: true, transparent: false, decorations: true },
    },
    enabled,
    status: { type: "Loaded" },
  };
}

describe("usePlugins", () => {
  it("loads plugins from get_plugins on mount", async () => {
    mockInvoke("get_plugins", [rec("translator")]);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plugins).toHaveLength(1);
    expect(result.current.plugins[0].manifest.id).toBe("translator");
  });

  it("refetches when plugins-changed fires", async () => {
    mockInvoke("get_plugins", [rec("a")]);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.plugins).toHaveLength(1));

    mockInvoke("get_plugins", [rec("a"), rec("b")]);
    await act(async () => {
      emitMockEvent("plugins-changed", undefined);
    });
    await waitFor(() => expect(result.current.plugins).toHaveLength(2));
  });

  it("setEnabled invokes the command with id + enabled", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("set_ani_plugin_enabled", null);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled("translator", false);
    });
    expect(invoke).toHaveBeenCalledWith("set_ani_plugin_enabled", { id: "translator", enabled: false });
  });

  it("uninstall invokes the command with id", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("uninstall_plugin", null);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.uninstall("translator");
    });
    expect(invoke).toHaveBeenCalledWith("uninstall_plugin", { id: "translator" });
  });

  it("launch invokes the command with id", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("launch_plugin", null);
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.launch("translator");
    });
    expect(invoke).toHaveBeenCalledWith("launch_plugin", { id: "translator" });
  });

  it("install ignores a user cancel (no error set)", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("install_plugin_from_dialog", () => {
      throw new Error("install canceled");
    });
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.error).toBeNull();
  });

  it("install surfaces a real error", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("install_plugin_from_dialog", () => {
      throw new Error("manifest.json missing from zip");
    });
    const { result } = renderHook(() => usePlugins());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.error).toMatch(/manifest.json missing/);
  });
});
