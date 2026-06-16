import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PluginManager } from "../../components/PluginManager";
import { mockInvoke } from "../../__mocks__/tauri";
import { invoke } from "@tauri-apps/api/core";
import type { PluginRecord } from "../../types/plugin";

function rec(id: string, over: Partial<PluginRecord> = {}): PluginRecord {
  return {
    manifest: {
      id, name: id, version: "0.1.0", description: "", author: "",
      entry: "index.html", capabilities: ["window", "storage"],
      window: { width: 100, height: 100, resizable: false, alwaysOnTop: true, transparent: false, decorations: true },
    },
    enabled: true,
    status: { type: "Loaded" },
    ...over,
  };
}

describe("PluginManager", () => {
  it("shows the empty state when no plugins are installed", async () => {
    mockInvoke("get_plugins", []);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-empty-state")).toBeInTheDocument();
  });

  it("renders a card per installed plugin", async () => {
    mockInvoke("get_plugins", [rec("translator"), rec("screenshot")]);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-card-translator")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-screenshot")).toBeInTheDocument();
  });

  it("shows a hotkey badge only when the manifest declares one", async () => {
    const withKey = rec("translator");
    withKey.manifest.hotkey = "CmdOrCtrl+Shift+V";
    mockInvoke("get_plugins", [withKey, rec("screenshot")]);
    render(<PluginManager />);

    const badge = await screen.findByTestId("plugin-hotkey-translator");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/V/);
    // The plugin without a hotkey shows no badge.
    expect(screen.queryByTestId("plugin-hotkey-screenshot")).toBeNull();
  });

  it("clicking the hotkey badge records a new shortcut and reassigns it", async () => {
    const withKey = rec("translator");
    withKey.manifest.hotkey = "CmdOrCtrl+Shift+V";
    mockInvoke("get_plugins", [withKey]);
    mockInvoke("set_plugin_hotkey", null);
    render(<PluginManager />);

    const badge = await screen.findByTestId("plugin-hotkey-translator");
    fireEvent.click(badge);
    expect(screen.getByTestId("plugin-hotkey-translator").textContent).toMatch(/press keys/i);

    fireEvent.keyDown(window, { key: "k", metaKey: true, shiftKey: true });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_plugin_hotkey", {
        id: "translator",
        hotkey: "CmdOrCtrl+Shift+K",
      })
    );
  });

  it("clicking the clear (✕) button clears the launch hotkey to empty", async () => {
    const withKey = rec("translator");
    withKey.manifest.hotkey = "CmdOrCtrl+Shift+V";
    mockInvoke("get_plugins", [withKey]);
    mockInvoke("set_plugin_hotkey", null);
    render(<PluginManager />);

    const clear = await screen.findByTestId("plugin-hotkey-clear-translator");
    fireEvent.click(clear);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_plugin_hotkey", {
        id: "translator",
        hotkey: "",
      })
    );
  });

  it("shows no clear button when a plugin has no launch hotkey", async () => {
    mockInvoke("get_plugins", [rec("screenshot")]);
    render(<PluginManager />);
    await screen.findByTestId("plugin-card-screenshot");
    expect(screen.queryByTestId("plugin-hotkey-clear-screenshot")).toBeNull();
  });

  it("records an Option-based shortcut via e.code (macOS rewrites e.key)", async () => {
    const withKey = rec("translator");
    withKey.manifest.hotkey = "CmdOrCtrl+Shift+V";
    mockInvoke("get_plugins", [withKey]);
    mockInvoke("set_plugin_hotkey", null);
    render(<PluginManager />);

    const badge = await screen.findByTestId("plugin-hotkey-translator");
    fireEvent.click(badge);

    // Option+T on macOS: the browser reports e.key as "†" but e.code stays "KeyT".
    fireEvent.keyDown(window, { key: "†", code: "KeyT", altKey: true });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_plugin_hotkey", {
        id: "translator",
        hotkey: "Alt+T",
      })
    );
  });

  it("shows an error badge with the reason for a broken plugin", async () => {
    mockInvoke("get_plugins", [rec("broken", { status: { type: "Error", reason: "bad manifest" } })]);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-error-broken")).toHaveTextContent("bad manifest");
  });

  it("launch button invokes launch_plugin", async () => {
    mockInvoke("get_plugins", [rec("translator")]);
    mockInvoke("launch_plugin", null);
    render(<PluginManager />);
    fireEvent.click(await screen.findByTestId("plugin-launch-btn-translator"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("launch_plugin", { id: "translator" }));
  });

  it("disables the launch button for a disabled plugin", async () => {
    mockInvoke("get_plugins", [rec("translator", { enabled: false })]);
    render(<PluginManager />);
    expect(await screen.findByTestId("plugin-launch-btn-translator")).toBeDisabled();
  });

  it("toggle invokes set_ani_plugin_enabled with the negated state", async () => {
    mockInvoke("get_plugins", [rec("translator", { enabled: true })]);
    mockInvoke("set_ani_plugin_enabled", null);
    render(<PluginManager />);
    fireEvent.click(await screen.findByTestId("plugin-enable-toggle-translator"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_ani_plugin_enabled", { id: "translator", enabled: false })
    );
  });

  it("uninstall requires a second confirming click", async () => {
    mockInvoke("get_plugins", [rec("translator")]);
    mockInvoke("uninstall_plugin", null);
    render(<PluginManager />);
    const btn = await screen.findByTestId("plugin-uninstall-btn-translator");

    fireEvent.click(btn); // first click → arms confirm, does NOT invoke
    expect(invoke).not.toHaveBeenCalledWith("uninstall_plugin", { id: "translator" });

    fireEvent.click(screen.getByTestId("plugin-uninstall-btn-translator")); // second click → invokes
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("uninstall_plugin", { id: "translator" }));
  });

  it("arming uninstall on one plugin resets when another is armed", async () => {
    mockInvoke("get_plugins", [rec("alpha"), rec("beta")]);
    mockInvoke("uninstall_plugin", null);
    render(<PluginManager />);

    const alphaBtn = await screen.findByTestId("plugin-uninstall-btn-alpha");
    fireEvent.click(alphaBtn); // arm alpha
    expect(screen.getByTestId("plugin-uninstall-btn-alpha")).toHaveTextContent("Confirm?");

    fireEvent.click(screen.getByTestId("plugin-uninstall-btn-beta")); // arm beta
    // alpha reverts, beta armed, nothing uninstalled yet
    expect(screen.getByTestId("plugin-uninstall-btn-alpha")).toHaveTextContent("Uninstall");
    expect(screen.getByTestId("plugin-uninstall-btn-beta")).toHaveTextContent("Confirm?");
    expect(invoke).not.toHaveBeenCalledWith("uninstall_plugin", { id: "alpha" });
  });

  it("install button invokes install_plugin_from_dialog", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("install_plugin_from_dialog", () => { throw new Error("install canceled"); });
    render(<PluginManager />);
    fireEvent.click(await screen.findByTestId("install-plugin-btn"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_plugin_from_dialog"));
  });
});
