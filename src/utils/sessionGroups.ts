import type { SessionInfo } from "../hooks/useSessions";

// Priority for picking a group's summary state: busy > service > idle.
export const statePriority: Record<string, number> = {
  busy: 3,
  service: 2,
  idle: 1,
};

export function groupState(sessions: SessionInfo[]): string {
  let best = "idle";
  let bestP = 0;
  for (const s of sessions) {
    const p = statePriority[s.ui_state] ?? 0;
    if (p > bestP) {
      bestP = p;
      best = s.ui_state;
    }
  }
  return best;
}

/** Turn /Users/you/dev/foo into ~/dev/foo when home is known. */
export function prettyPath(pwd: string, home?: string): string {
  if (!pwd) return "";
  if (home && pwd.startsWith(home)) return "~" + pwd.slice(home.length);
  return pwd;
}

/** Last path segment of a group (the leaf folder name). Falls back to the
 *  pretty path or a sensible string when pwd is missing. */
export function groupBasename(g: { pwd: string; pretty: string; sessions: SessionInfo[] }): string {
  if (g.pwd) {
    const leaf = g.pwd.split("/").filter(Boolean).pop();
    if (leaf) return leaf;
  }
  return g.pretty || g.sessions[0]?.title || "";
}

/** Human-readable label for what's happening in a single shell. */
export function shellLabel(s: SessionInfo): string {
  if (s.has_claude) return "claude";
  if (s.fg_cmd) {
    return s.fg_cmd.replace(/^-/, "");
  }
  if (s.ui_state === "busy" && s.busy_type) return s.busy_type;
  if (s.ui_state === "service") return "service";
  return "idle";
}

export interface Group {
  key: string;
  pwd: string;
  pretty: string;
  sessions: SessionInfo[];
  state: string;
  isClaudeFallback: boolean;
}

export function groupSessions(sessions: SessionInfo[], home?: string): Group[] {
  const claudeVirtual = sessions.find((s) => s.pid === 0);
  const anyShellHasClaude = sessions.some((s) => s.pid !== 0 && s.has_claude);

  const byKey = new Map<string, { pwd: string; list: SessionInfo[] }>();
  for (const s of sessions) {
    if (s.pid === 0) continue;
    if (s.is_claude_proc) continue;
    const key = s.pwd || s.title || String(s.pid);
    if (!byKey.has(key)) byKey.set(key, { pwd: s.pwd, list: [] });
    byKey.get(key)!.list.push(s);
  }

  const groups: Group[] = [];
  for (const [key, { pwd, list }] of byKey.entries()) {
    const pretty = pwd
      ? prettyPath(pwd, home)
      : list[0].title || `pid ${list[0].pid}`;
    // Sort children within a group by pid so row order stays stable
    // across refreshes. The backend returns sessions from a HashMap,
    // so iteration order can change between invocations — without this
    // sort, rows can swap under the cursor every 3s refresh and the
    // CSS :hover highlight flickers off the row you're hovering.
    list.sort((a, b) => a.pid - b.pid);
    groups.push({
      key,
      pwd,
      pretty,
      sessions: list,
      state: groupState(list),
      isClaudeFallback: false,
    });
  }

  groups.sort((a, b) => {
    const pa = statePriority[a.state] ?? 0;
    const pb = statePriority[b.state] ?? 0;
    if (pa !== pb) return pb - pa;
    return a.pretty.localeCompare(b.pretty);
  });

  if (claudeVirtual && !anyShellHasClaude) {
    groups.push({
      key: "claude-virtual",
      pwd: "",
      pretty: "Claude Code",
      sessions: [claudeVirtual],
      state: claudeVirtual.ui_state,
      isClaudeFallback: true,
    });
  }

  return groups;
}

export function detectHome(sessions: SessionInfo[]): string | undefined {
  for (const s of sessions) {
    const m = s.pwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
    if (m) return m[1];
  }
  return undefined;
}

export function reflectActiveServices(sessions: SessionInfo[]): SessionInfo[] {
  return sessions.map((s) =>
    s.busy_type === "service" && s.ui_state === "idle"
      ? { ...s, ui_state: "service" }
      : s,
  );
}

export function overlayClaudeState(sessions: SessionInfo[]): SessionInfo[] {
  const sessionByPid = new Map<number, SessionInfo>();
  for (const s of sessions) sessionByPid.set(s.pid, s);

  return sessions.map((s) => {
    if (!s.has_claude) return s;
    const claudeSession =
      (s.claude_pid != null && sessionByPid.get(s.claude_pid)) ||
      sessionByPid.get(0);
    if (!claudeSession) return s;
    const claudeP = statePriority[claudeSession.ui_state] ?? 0;
    const ownP = statePriority[s.ui_state] ?? 0;
    return ownP >= claudeP ? s : { ...s, ui_state: claudeSession.ui_state };
  });
}
