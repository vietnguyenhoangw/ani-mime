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
      <div className="plugin-manager-header">
        <p className="plugin-manager-desc">
          Install mini-app plugins from a <code>.zip</code>. Plugins run in their own window.
        </p>
        <button
          type="button"
          className="plugin-install-btn"
          data-testid="install-plugin-btn"
          onClick={() => install()}
        >
          Install plugin…
        </button>
      </div>

      {error && (
        <div className="plugin-error-banner" role="alert" data-testid="plugin-error-banner">
          {error}
        </div>
      )}

      {loading ? (
        <p className="plugin-loading" data-testid="plugin-loading">Loading…</p>
      ) : plugins.length === 0 ? (
        <p className="plugin-empty" data-testid="plugin-empty-state">
          No plugins installed yet.
        </p>
      ) : (
        <ul className="plugin-list">
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
        </ul>
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
    <li className="plugin-card" data-testid={`plugin-card-${manifest.id}`}>
      <div className="plugin-card-main">
        <div className="plugin-card-title">
          <span className="plugin-name">{manifest.name}</span>
          <span className="plugin-version">v{manifest.version}</span>
        </div>
        {manifest.description && <p className="plugin-card-desc">{manifest.description}</p>}
        <div className="plugin-caps">
          {manifest.capabilities.map((c) => (
            <span key={c} className="plugin-cap-chip" data-testid={`plugin-cap-${manifest.id}-${c}`}>
              {c}
            </span>
          ))}
        </div>
        {errorReason && (
          <p className="plugin-error" data-testid={`plugin-error-${manifest.id}`}>
            {errorReason}
          </p>
        )}
      </div>

      <div className="plugin-card-actions">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${manifest.name}`}
          className={`plugin-toggle ${enabled ? "on" : "off"}`}
          data-testid={`plugin-enable-toggle-${manifest.id}`}
          disabled={isError}
          onClick={onToggle}
        >
          {enabled ? "On" : "Off"}
        </button>
        <button
          type="button"
          className="plugin-launch-btn"
          data-testid={`plugin-launch-btn-${manifest.id}`}
          disabled={!enabled || isError}
          onClick={onLaunch}
        >
          Launch
        </button>
        <button
          type="button"
          className={`plugin-uninstall-btn ${confirming ? "confirming" : ""}`}
          data-testid={`plugin-uninstall-btn-${manifest.id}`}
          onClick={onUninstall}
        >
          {confirming ? "Confirm?" : "Uninstall"}
        </button>
      </div>
    </li>
  );
}
