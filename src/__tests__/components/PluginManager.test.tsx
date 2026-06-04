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

  it("install button invokes install_plugin_from_dialog", async () => {
    mockInvoke("get_plugins", []);
    mockInvoke("install_plugin_from_dialog", () => { throw new Error("install canceled"); });
    render(<PluginManager />);
    fireEvent.click(await screen.findByTestId("install-plugin-btn"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_plugin_from_dialog"));
  });
});
