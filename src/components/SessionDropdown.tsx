import { invoke } from "@tauri-apps/api/core";
import { groupBasename, shellLabel, type Group } from "../utils/sessionGroups";

interface SessionDropdownProps {
  groups: Group[];
  collapsed: Set<string>;
  toggleCollapsed: (key: string) => void;
  onPickSession: () => void;
  style?: React.CSSProperties;
  showPathTooltip: (el: HTMLElement, text: string) => void;
  hidePathTooltip: () => void;
}

export function SessionDropdown({
  groups,
  collapsed,
  toggleCollapsed,
  onPickSession,
  style,
  showPathTooltip,
  hidePathTooltip,
}: SessionDropdownProps) {
  return (
    <div
      data-testid="session-dropdown"
      className="session-dropdown"
      role="menu"
      style={style}
    >
      {groups.length === 0 ? (
        <div className="session-empty">No active terminals</div>
      ) : (
        groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          const headContent = (
            <>
              {!g.isClaudeFallback && (
                <span className="session-group-caret" aria-hidden="true" />
              )}
              <span className={`dot small ${g.state}`} />
              <span className="session-group-title-row">
                <span className="session-group-title">{groupBasename(g)}</span>
                {g.pretty && g.pretty !== groupBasename(g) && (
                  <span
                    className="session-group-info"
                    aria-label={`Full path: ${g.pretty}`}
                    onMouseEnter={(e) =>
                      showPathTooltip(e.currentTarget, g.pretty)
                    }
                    onMouseLeave={hidePathTooltip}
                  >
                    ?
                  </span>
                )}
              </span>
            </>
          );
          return (
            <div
              key={g.key}
              className={`session-group ${g.isClaudeFallback ? "claude" : ""}`}
              data-testid={`session-group-${g.key}`}
            >
              {g.isClaudeFallback ? (
                <div className="session-group-head">{headContent}</div>
              ) : (
                <button
                  type="button"
                  className={`session-group-head clickable ${isCollapsed ? "collapsed" : ""}`}
                  data-testid={`session-group-head-${g.key}`}
                  aria-expanded={!isCollapsed}
                  aria-controls={`session-children-${g.key}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapsed(g.key);
                  }}
                >
                  {headContent}
                </button>
              )}

              {!g.isClaudeFallback && !isCollapsed && (
                <div
                  className="session-children"
                  id={`session-children-${g.key}`}
                >
                  {g.sessions.map((s) => (
                    <button
                      key={s.pid}
                      type="button"
                      className={`session-child ${s.has_claude ? "has-claude" : ""}`}
                      data-testid={`session-item-${s.pid}`}
                      title="Click to bring this terminal to the front"
                      onClick={(e) => {
                        e.stopPropagation();
                        invoke("focus_terminal", {
                          pid: s.pid,
                          tty: s.tty || null,
                        }).catch((err) =>
                          console.error("[focus_terminal]", err)
                        );
                        onPickSession();
                      }}
                    >
                      <span className={`dot small ${s.ui_state}`} />
                      <span className="session-child-label-row">
                        <span className="session-child-label">
                          {shellLabel(s)}
                        </span>
                        {s.has_claude && (
                          <span
                            className="session-child-claude"
                            aria-label="Claude Code running"
                          />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
