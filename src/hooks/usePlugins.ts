import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PluginRecord } from "../types/plugin";

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<PluginRecord[]>("get_plugins");
      setPlugins(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const un = listen("plugins-changed", () => {
      refresh();
    });
    return () => {
      un.then((fn) => fn());
    };
  }, [refresh]);

  const install = useCallback(async () => {
    setError(null);
    try {
      await invoke("install_plugin_from_dialog");
    } catch (e) {
      const msg = String(e);
      // A user cancel is not a failure.
      if (!/cancel/i.test(msg)) setError(msg);
    }
    await refresh();
  }, [refresh]);

  const uninstall = useCallback(async (id: string) => {
    setError(null);
    try {
      await invoke("uninstall_plugin", { id });
    } catch (e) {
      setError(String(e));
    }
    await refresh();
  }, [refresh]);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    setError(null);
    try {
      await invoke("set_ani_plugin_enabled", { id, enabled });
    } catch (e) {
      setError(String(e));
    }
    await refresh();
  }, [refresh]);

  const launch = useCallback(async (id: string) => {
    setError(null);
    try {
      await invoke("launch_plugin", { id });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { plugins, loading, error, install, uninstall, setEnabled, launch, refresh };
}
