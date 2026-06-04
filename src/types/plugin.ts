/** Frontend mirrors of the Rust `PluginRecord` (see src-tauri/src/plugin). */

/** Window config from the manifest (serde camelCase). */
export interface PluginWindowConfig {
  width: number;
  height: number;
  resizable: boolean;
  alwaysOnTop: boolean;
  transparent: boolean;
  decorations: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  icon?: string;
  hotkey?: string;
  capabilities: string[];
  window: PluginWindowConfig;
}

/** Tagged enum: `{ type: "Loaded" }` or `{ type: "Error", reason }`. */
export type PluginStatus =
  | { type: "Loaded" }
  | { type: "Error"; reason: string };

export interface PluginRecord {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  webview_label?: string;
}
