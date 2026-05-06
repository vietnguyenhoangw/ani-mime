# proc_scan performance fix

**Date:** 2026-05-06
**Status:** Approved (pending implementation plan)
**Owner:** vietnguyenhoangw

## Problem

The Ani-Mime app idles at ~5–10% CPU. Investigation pinned the cost to `proc_scan::scan_processes()` (`src-tauri/src/proc_scan.rs`), which runs every 2 seconds.

On a typical Mac (~837 PIDs in this user's environment) one scan executes:

| Per PID | Cost | Used by |
|---|---|---|
| `proc_pid::name()` | 1 syscall | filter + claude detection |
| `pidinfo::<BSDInfo>` | 1 syscall (~152 B copy) | filter + claude parent walk |
| `get_cwd_macos()` (`PROC_PIDVNODEPATHINFO`) | 1 syscall (~2 KB copy) | **only used for shells** |
| `read_argv0()` | 1 sysctl | only when `is_shell` / `node` / version-string (already gated) |

That is ~2,500 syscalls every 2 s and ~840 KB/s of kernel→user memcpy, ~99% of which is thrown away because cwd is consumed only for the ~5 PIDs that survive `is_user_terminal()`.

Discovery, broadcast, and the frontend rAF loop have already been ruled out — the user's `LAN Peer List` is disabled, and `Mascot.tsx` short-circuits its rAF loop while frozen.

## Goals

- Reduce steady-state CPU of the proc_scan thread by ≥80% without changing observable behavior.
- Keep the change small enough to review in one PR.
- Preserve correctness for the existing manual smoke flow (multi-tab pwd refresh, claude attachment, zombie cleanup).

## Non-goals

- Adaptive polling interval.
- Bulk `sysctl(KERN_PROC_ALL)` rewrite.
- Event-driven scanning (`kqueue(EVFILT_PROC)`, EndpointSecurity).
- Changes to the click-to-focus path (`focus.rs`) or to `get_proc_info()` callers outside the hot loop.

Each non-goal is a separate, larger design and is intentionally deferred.

## Design

Three stacking changes, all in `src-tauri/src/proc_scan.rs`:

### 1. Filter PIDs at the OS by current UID

Replace the deprecated `listpids(ProcType::ProcAllPIDS)` call with `processes::pids_by_type(ProcFilter::ByUID { uid })`, where `uid` is `libc::geteuid()`. This drops kernel and root-owned daemons before they enter the loop — roughly 50% of the PID list on a normal user Mac.

### 2. Drop the redundant `proc_pid::name()` call

`BSDInfo` already carries the same short name in `pbi_comm` (16 chars + NUL). Read the name from the BSDInfo result instead of issuing a separate `name()` syscall. Saves one syscall per surviving PID.

A small helper converts the C buffer to a Rust `String`:

```rust
fn pbi_comm_to_string(comm: &[std::os::raw::c_char; 16]) -> String {
    let bytes: Vec<u8> = comm.iter()
        .take_while(|&&b| b != 0)
        .map(|&b| b as u8)
        .collect();
    String::from_utf8(bytes).unwrap_or_default()
}
```

`BSDInfo.pbi_comm` is `[c_char; MAXCOMLEN]` where `MAXCOMLEN = 16` — the kernel does not include a trailing NUL slot in the libproc binding, so `take_while` simply consumes the whole array when the name is exactly 16 bytes. The truncation/empty-on-bad-utf8 behavior matches `proc_pid::name()`, so `is_shell()` and `looks_like_version_string()` continue to work unchanged.

### 3. Gate `get_cwd_macos()` on `is_shell(name)`

Mirror the existing argv0 gating (`proc_scan.rs:480`) for cwd:

```rust
let cwd = if is_shell(&name) {
    get_cwd_macos(pid as i32)
} else {
    None
};
```

cwd is consumed only inside `reconcile()` for entries that pass `is_user_terminal()` — which already requires `is_shell(&name)`. Fetching cwd for non-shell PIDs is dead work.

Apply the same gating to `get_proc_info()` (single-PID diagnostic helper) for consistency, even though it is not on the hot path.

## Expected impact

| Metric | Before | After |
|---|---|---|
| Syscalls / scan | ~2,500 | ~415 |
| Syscalls / sec | ~1,250 | ~210 |
| Kernel→user memcpy / sec | ~840 KB | ~35 KB |

CPU expectation on the user's machine: ~5–10% → ~1–2% steady-state for the Ani-Mime process. Verification is manual (Activity Monitor / `sample`) since no perf-regression test harness exists.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| UID filter excludes a PID we care about (e.g., `sudo claude`) | Documented as unsupported. `focus_terminal` does not depend on `scan_processes()` — it uses `proc_pid::pidpath()` + a `ps`-built ppid map, which already handles cross-UID. |
| `pbi_comm` truncated to 16 chars changes filtering behavior | Same buffer `proc_pid::name()` returns. Identical truncation. |
| `pidinfo<BSDInfo>` fails for a listed PID | Skip the PID (`continue`). Post-UID-filter, denials are rare. Matches current behavior on `name()` failure. |
| Library crate API drift | `pids_by_type` and `ProcFilter::ByUID` are the supported, non-deprecated API in `libproc 0.14` (the version pinned in `Cargo.toml`). |

## Verification

- `cd src-tauri && cargo check` — passes.
- Manual smoke test:
  1. Open 2–3 terminal tabs; `cd` into different directories — pwd updates in mascot session list within 2 s.
  2. Run `claude` in one tab — Claude logo appears on that tab's session row.
  3. Run `bun run tauri dev` in another — `fg_cmd` resolves to `bun` (or `node`).
  4. Close a shell tab — session disappears within 2 s.
- CPU before/after via Activity Monitor while idle (no terminals active).

No automated tests are added. `scan_processes` depends on libproc and is not unit-testable without significant scaffolding; existing code has no test coverage for it. Behavior coverage stays at the smoke-test level.

## Files touched

- `src-tauri/src/proc_scan.rs` — the only file modified.

## Out of scope (recorded for later)

- Adaptive polling: slow the scan to 5–10 s when no shells are alive.
- Bulk `sysctl(KERN_PROC_ALL)` to drop the per-PID loop entirely.
- Event-driven process lifecycle (`kqueue(EVFILT_PROC)` per tracked PID; EndpointSecurity for global). The latter requires Apple-issued entitlements.
- Frontend rAF loop tuning (verified not the bottleneck this round).
