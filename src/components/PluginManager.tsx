import { useState } from "react";
import { usePlugins } from "../hooks/usePlugins";
import type { PluginRecord } from "../types/plugin";
import "../styles/plugin-manager.css";

export function PluginManager() {
  const { plugins, loading, error, install, uninstall, setEnabled, launch } = usePlugins();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleUninstall = (id: string) => {
    if (confirmId === id) {
      setConfirmId(null);
      uninstall(id);
    } else {
      setConfirmId(id);
    }
  };

  return (
    <div className="plugin-manager" data-testid="plugin-manager">
      <div className="settings-card">
        <div className="settings-row with-hint">
          <div>
            <span className="settings-row-label">Installed Plugins</span>
            <span className="settings-row-hint">
              Install mini-app plugins from a <code>.zip</code>. Each plugin runs in its own window.
            </span>
          </div>
          <button
            type="button"
            className="settings-action-btn"
            data-testid="install-plugin-btn"
            onClick={() => install()}
          >
            Install…
          </button>
        </div>
      </div>

      {error && (
        <div className="plugin-error-banner" role="alert" data-testid="plugin-error-banner">
          {error}
        </div>
      )}

      {loading ? (
        <p className="settings-section-desc" data-testid="plugin-loading">Loading…</p>
      ) : plugins.length === 0 ? (
        <p className="settings-section-desc" data-testid="plugin-empty-state">
          No plugins installed yet.
        </p>
      ) : (
        <div className="plugin-list">
          {plugins.map((p) => (
            <PluginCard
              key={p.manifest.id}
              record={p}
              confirming={confirmId === p.manifest.id}
              onLaunch={() => launch(p.manifest.id)}
              onToggle={() => setEnabled(p.manifest.id, !p.enabled)}
              onUninstall={() => handleUninstall(p.manifest.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PluginCard({
  record,
  confirming,
  onLaunch,
  onToggle,
  onUninstall,
}: {
  record: PluginRecord;
  confirming: boolean;
  onLaunch: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}) {
  const { manifest, enabled, status } = record;
  const isError = status.type === "Error";
  const errorReason = status.type === "Error" ? status.reason : null;

  return (
    <div
      className={`settings-card plugin-card ${enabled ? "" : "is-disabled"}`}
      data-testid={`plugin-card-${manifest.id}`}
    >
      <div className="plugin-card-head">
        <span className="plugin-name">
          {manifest.name}
          <span className="plugin-version">v{manifest.version}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${manifest.name}`}
          className={`toggle-switch ${enabled ? "active" : ""}`}
          data-testid={`plugin-enable-toggle-${manifest.id}`}
          disabled={isError}
          onClick={onToggle}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {manifest.description && (
        <p className="plugin-desc">{manifest.description}</p>
      )}

      {manifest.capabilities.length > 0 && (
        <div className="plugin-caps">
          {manifest.capabilities.map((c) => (
            <span key={c} className="plugin-cap-chip" data-testid={`plugin-cap-${manifest.id}-${c}`}>
              {c}
            </span>
          ))}
        </div>
      )}

      {errorReason && (
        <p className="plugin-error" data-testid={`plugin-error-${manifest.id}`}>
          {errorReason}
        </p>
      )}

      <div className="plugin-card-foot">
        <button
          type="button"
          className="settings-action-btn"
          data-testid={`plugin-launch-btn-${manifest.id}`}
          disabled={!enabled || isError}
          onClick={onLaunch}
        >
          Launch
        </button>
        <button
          type="button"
          className={`settings-action-btn ${confirming ? "plugin-uninstall-confirming" : ""}`}
          data-testid={`plugin-uninstall-btn-${manifest.id}`}
          onClick={onUninstall}
        >
          {confirming ? "Confirm?" : "Uninstall"}
        </button>
      </div>
    </div>
  );
}
