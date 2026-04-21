import "../styles/dev-build-badge.css";

/** Renders only in `bun run tauri dev` builds — Vite sets
 *  `import.meta.env.DEV` to true there and false for `vite build` (release).
 *  Hover shows a guideline tooltip that tells the developer how to unlock
 *  the Superpower tool: click the Version label in Settings 10 times. */
export function DevBuildBadge() {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      className="dev-build-badge"
      data-testid="dev-build-badge"
      role="tooltip"
      aria-label="Click the Version label in Settings 10 times to enable the Superpower debug tool"
    >
      DEV
      <span className="dev-build-badge-tip" aria-hidden="true">
        Click <strong>Version</strong> in Settings <strong>10×</strong> to unlock <strong>Superpower</strong>.
      </span>
    </div>
  );
}
