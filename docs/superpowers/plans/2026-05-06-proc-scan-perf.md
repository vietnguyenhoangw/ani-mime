# proc_scan Performance Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop steady-state CPU of the `proc_scan` thread from ~5–10% to ~1–2% by eliminating wasted per-PID syscalls, without changing observable behavior.

**Architecture:** Three stacking changes inside a single file (`src-tauri/src/proc_scan.rs`): (1) gate the `PROC_PIDVNODEPATHINFO` cwd lookup on `is_shell(name)`, (2) filter `listpids` by current effective UID, (3) drop the redundant `proc_pid::name()` call by reading `pbi_comm` from the existing `BSDInfo` result. No public API or behavior change; covered by spec `docs/superpowers/specs/2026-05-06-proc-scan-perf-design.md`.

**Tech Stack:** Rust 1.x, `libproc 0.14`, macOS-only code paths gated by `#[cfg(target_os = "macos")]`. Existing project conventions: tests inside `#[cfg(test)] mod tests` blocks at the bottom of the same file, FFI declared via inline `extern "C"` (no direct `libc` crate dep).

---

## File Structure

Only one source file is modified.

| File | Responsibility |
|---|---|
| `src-tauri/src/proc_scan.rs` (modify) | Process enumeration + reconciliation. All three changes happen here. |

The file already mixes pure helpers, FFI shims, and the polling loop. The plan keeps that shape: the new helper (`pbi_comm_to_string`) is added next to the existing pure helpers (`argv0_basename`, `looks_like_version_string`, etc.) and the new `geteuid_safe()` FFI shim sits with the other inline `extern "C"` blocks (`sysctl`, `devname`).

---

## Task ordering rationale

Task order is **biggest-win-first, lowest-risk-first**. After Task 1, the user already has the dominant performance win even if Tasks 2–4 are deferred. Each task ends with a green `cargo check` and a commit. Functional verification is consolidated into Task 5 (manual smoke + perf measurement) because `scan_processes` is libproc-dependent and not unit-testable without significant scaffolding.

---

## Task 1: Gate `get_cwd_macos` on `is_shell(name)`

**Why first:** This is the dominant cost (one ~2 KB syscall per PID, ~830 of which are wasted per scan). Single-line gate. Zero risk of breaking behavior — `cwd` is read in `reconcile()` only inside the `for t in &live_terminals` loop, and `is_user_terminal()` already requires `is_shell(&name)`, so non-shell PIDs never consume the field today.

**Files:**
- Modify: `src-tauri/src/proc_scan.rs`

- [ ] **Step 1: Read the current `scan_processes()` body and locate the cwd line**

Run: `grep -n "let cwd = get_cwd_macos" src-tauri/src/proc_scan.rs`
Expected output: two matches — one inside `get_proc_info()` (~line 368), one inside `scan_processes()` (~line 473).

- [ ] **Step 2: Replace the cwd line in `scan_processes()`**

Anchor the edit by surrounding context. In the loop inside `scan_processes()`, find the unconditional cwd fetch:

```rust
        let cwd = get_cwd_macos(pid as i32);

        // Only spend a sysctl roundtrip on processes that might be Claude
```

Replace with:

```rust
        // Only fetch cwd for shells — it's the only type of process whose
        // cwd we consume (in reconcile() via is_user_terminal -> is_shell).
        // PROC_PIDVNODEPATHINFO copies a ~2 KB struct per call, so doing it
        // unconditionally for every PID on the system was the dominant
        // cost of this scan loop.
        let cwd = if is_shell(&name) {
            get_cwd_macos(pid as i32)
        } else {
            None
        };

        // Only spend a sysctl roundtrip on processes that might be Claude
```

- [ ] **Step 3: Apply the same gate inside `get_proc_info()`**

`get_proc_info()` is the single-PID diagnostic helper (used outside the hot loop). Gate it for consistency. Find:

```rust
    let cwd = get_cwd_macos(pid as i32);
    let argv0 = if name == "node" || is_shell(&name) {
```

Replace with:

```rust
    let cwd = if is_shell(&name) {
        get_cwd_macos(pid as i32)
    } else {
        None
    };
    let argv0 = if name == "node" || is_shell(&name) {
```

- [ ] **Step 4: Type-check**

Run: `cd src-tauri && cargo check`
Expected: `Finished` with no errors. (Warnings about unused imports etc. are unrelated.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/proc_scan.rs
git commit -m "$(cat <<'EOF'
perf(proc_scan): gate cwd lookup on is_shell

PROC_PIDVNODEPATHINFO copies a ~2 KB struct per call. The cwd field is
only consumed by reconcile() inside the live_terminals loop, which
already requires is_shell(&name). Fetching it for every PID on the
system was ~99% wasted work — the dominant cost of the 2 s scan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Filter `listpids` by current effective UID

**Why second:** Drops kernel and root-owned daemons before they enter the loop (typically halves PID count). Uses the supported, non-deprecated `processes::pids_by_type(ProcFilter::ByUID { uid })` API in `libproc 0.14`. UID is fetched via an inline `extern "C"` shim, matching the file's existing FFI style (no new Cargo dep).

**Files:**
- Modify: `src-tauri/src/proc_scan.rs`

- [ ] **Step 1: Add an inline `extern "C"` shim for `geteuid` near the top of the macOS-only code**

Find the existing FFI block for `sysctl` (inside `read_argv0`). Right above the `#[cfg(target_os = "macos")] fn scan_processes()` function definition, add:

```rust
/// Effective UID of the running process. Used to filter `proc_listpids`
/// down to user-owned PIDs and skip kernel/root daemons that we will
/// never care about.
#[cfg(target_os = "macos")]
fn geteuid_safe() -> u32 {
    extern "C" {
        fn geteuid() -> u32;
    }
    unsafe { geteuid() }
}
```

- [ ] **Step 2: Replace the `listpids` call inside `scan_processes()`**

Add this import near the top of the file, alongside the existing `libproc` imports:

```rust
#[cfg(target_os = "macos")]
use libproc::processes::{pids_by_type, ProcFilter};
```

Then in `scan_processes()`, find:

```rust
    let pids = match proc_pid::listpids(proc_pid::ProcType::ProcAllPIDS) {
        Ok(p) => p,
        Err(e) => {
            crate::app_warn!("[proc_scan] listpids failed: {}", e);
            return Vec::new();
        }
    };
```

Replace with:

```rust
    // Filter to the current user's processes at the OS level. Drops
    // kernel_task and root-owned daemons (~half the system's PIDs on a
    // typical Mac) before we pay the per-PID syscall cost. Shells and
    // claude both run as the user, so nothing we care about is excluded.
    // sudo'd processes are intentionally not tracked — same as before.
    let uid = geteuid_safe();
    let pids = match pids_by_type(ProcFilter::ByUID { uid }) {
        Ok(p) => p,
        Err(e) => {
            crate::app_warn!("[proc_scan] pids_by_type(ByUID {{uid={}}}) failed: {}", uid, e);
            return Vec::new();
        }
    };
```

- [ ] **Step 3: Type-check**

Run: `cd src-tauri && cargo check`
Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/proc_scan.rs
git commit -m "$(cat <<'EOF'
perf(proc_scan): filter listpids by current UID

Use the supported pids_by_type(ProcFilter::ByUID) API instead of the
deprecated listpids(ProcAllPIDS). Drops kernel/root daemons at the OS
level — typically halves the PID count we then iterate. User shells
and claude both run as the user, so nothing we track is excluded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `pbi_comm_to_string` helper (TDD)

**Why third:** Pure function, can be properly unit-tested. Prepares for Task 4. Done before Task 4 so the helper is in place when we drop `proc_pid::name()`.

**Files:**
- Modify: `src-tauri/src/proc_scan.rs`

- [ ] **Step 1: Locate the existing `#[cfg(test)] mod tests` block — it does not exist in this file**

Run: `grep -n "^#\[cfg(test)\]" src-tauri/src/proc_scan.rs`
Expected: no matches. We will add a new `tests` module at the bottom of the file.

- [ ] **Step 2: Write the failing tests at the bottom of `proc_scan.rs`**

Append to the end of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::os::raw::c_char;

    fn make_comm(s: &str) -> [c_char; 17] {
        let mut buf = [0 as c_char; 17];
        for (i, b) in s.bytes().enumerate() {
            if i >= 16 { break; } // leave the trailing NUL
            buf[i] = b as c_char;
        }
        buf
    }

    #[test]
    fn pbi_comm_to_string_reads_until_first_nul() {
        let comm = make_comm("zsh");
        assert_eq!(pbi_comm_to_string(&comm), "zsh");
    }

    #[test]
    fn pbi_comm_to_string_returns_empty_for_all_zero_buffer() {
        let comm = [0 as c_char; 17];
        assert_eq!(pbi_comm_to_string(&comm), "");
    }

    #[test]
    fn pbi_comm_to_string_handles_full_16_byte_name_without_nul_in_first_16() {
        // p_comm is 16 chars + NUL at index 16. A 16-char process name fills
        // indices 0..15 and the NUL sits at index 16. We must read all 16
        // bytes, not stop early.
        let comm = make_comm("abcdefghijklmnop"); // exactly 16 chars
        assert_eq!(pbi_comm_to_string(&comm), "abcdefghijklmnop");
    }

    #[test]
    fn pbi_comm_to_string_returns_empty_for_invalid_utf8() {
        let mut comm = [0 as c_char; 17];
        comm[0] = 0xFFu8 as c_char; // invalid utf-8 start byte
        comm[1] = 0xFEu8 as c_char;
        assert_eq!(pbi_comm_to_string(&comm), "");
    }
}
```

- [ ] **Step 3: Run tests to verify they fail with "function not defined"**

Run: `cd src-tauri && cargo test -p ani-mime-lib --lib proc_scan::tests::`
Expected: compile error — `cannot find function pbi_comm_to_string in this scope`.

- [ ] **Step 4: Add the helper function near the other pure helpers**

In `proc_scan.rs`, find the existing helper:

```rust
/// Just the basename of argv[0] (strip any leading dirs).
fn argv0_basename(s: &str) -> &str {
    s.rsplit('/').next().unwrap_or(s)
}
```

Right above it, add:

```rust
/// Convert the C-string `pbi_comm` field of a `BSDInfo` (16 chars + NUL)
/// to a Rust `String`. Stops at the first NUL byte; returns an empty
/// string if the bytes are not valid UTF-8 (matches the lossy behavior
/// of `proc_pid::name()` on garbage input).
fn pbi_comm_to_string(comm: &[std::os::raw::c_char; 17]) -> String {
    let bytes: Vec<u8> = comm.iter()
        .take_while(|&&b| b != 0)
        .map(|&b| b as u8)
        .collect();
    String::from_utf8(bytes).unwrap_or_default()
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `cd src-tauri && cargo test -p ani-mime-lib --lib proc_scan::tests::`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/proc_scan.rs
git commit -m "$(cat <<'EOF'
proc_scan: add pbi_comm_to_string helper with tests

Pure function that converts a BSDInfo pbi_comm C buffer to a Rust
String. Will replace the redundant proc_pid::name() syscall in the
next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Use `pbi_comm` from BSDInfo, drop `proc_pid::name()`

**Why fourth:** With the helper in place, we can remove the redundant `name()` syscall (one less syscall per surviving PID). Order matters — the BSDInfo call must happen before we know the name, so the loop body needs a small reshuffle.

**Files:**
- Modify: `src-tauri/src/proc_scan.rs`

- [ ] **Step 1: Replace the loop body inside `scan_processes()`**

Find the existing block:

```rust
    let mut out = Vec::new();
    for pid in pids {
        let name = match proc_pid::name(pid as i32) {
            Ok(n) => n,
            Err(_) => continue,
        };

        let (ppid, pgid, tpgid, tdev) = match proc_pid::pidinfo::<BSDInfo>(pid as i32, 0) {
            Ok(info) => (info.pbi_ppid, info.pbi_pgid, info.e_tpgid, info.e_tdev),
            Err(_) => (0, 0, 0, 0),
        };
```

Replace with:

```rust
    let mut out = Vec::new();
    for pid in pids {
        // pidinfo<BSDInfo> gives us name (pbi_comm), ppid, pgid, tpgid,
        // tdev in a single syscall. Skip the PID if it can't be read —
        // post-UID-filter this is rare (the PID either exited between
        // listpids and pidinfo, or we somehow lack permission).
        let info = match proc_pid::pidinfo::<BSDInfo>(pid as i32, 0) {
            Ok(i) => i,
            Err(_) => continue,
        };
        let name = pbi_comm_to_string(&info.pbi_comm);
        if name.is_empty() {
            continue;
        }
        let (ppid, pgid, tpgid, tdev) =
            (info.pbi_ppid, info.pbi_pgid, info.e_tpgid, info.e_tdev);
```

Note: the previous code returned `(0, 0, 0, 0)` if pidinfo failed but kept the entry (using a name-only ProcInfo). After this change a pidinfo failure causes the PID to be skipped, which is consistent with the previous behavior on a `name()` failure (also `continue`). Keeping zombie/dead PIDs in `out` with bogus zeroed fields was already a hazard for `is_user_terminal` (`tdev == 0` → not a terminal anyway), so dropping them is strictly safer.

- [ ] **Step 2: Type-check**

Run: `cd src-tauri && cargo check`
Expected: `Finished` with no errors.

- [ ] **Step 3: Run the full test suite to make sure helper tests still pass**

Run: `cd src-tauri && cargo test -p ani-mime-lib --lib proc_scan::tests::`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/proc_scan.rs
git commit -m "$(cat <<'EOF'
perf(proc_scan): read name from BSDInfo, drop separate name() syscall

BSDInfo.pbi_comm is the same 16-char p_comm field that proc_pid::name()
returns, so calling both was redundant. Folding them into one syscall
saves ~one call per surviving PID per scan (~400/scan on a typical Mac).
PIDs whose pidinfo fails are now skipped (was: kept with zeroed fields,
which is_user_terminal already filtered out via tdev==0).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Manual smoke test and perf verification

No commits in this task — verification only. Records the before/after CPU numbers in your head (or in a follow-up note) so the perf claim in the spec is grounded.

- [ ] **Step 1: Build a release binary**

Run: `cd /Users/vietnguyenw.silentium/Desktop/vietnguyenw/dev/ani-mime && bun run tauri build`
Expected: produces a fresh `.app` under `src-tauri/target/release/bundle/macos/`.

(If you'd rather iterate in dev mode, use `bun run tauri dev` instead — but CPU numbers from the dev build are not representative.)

- [ ] **Step 2: Functional smoke test — multi-shell pwd refresh**

  1. Quit any running Ani-Mime instance.
  2. Launch the freshly built app.
  3. Open three terminal tabs. In each, `cd` to a different directory.
  4. Click the mascot status pill → expand the session list.
  5. Verify each tab shows its actual current directory within ~2 s of `cd`.

Expected: pwd values match.

- [ ] **Step 3: Functional smoke test — claude attachment**

  1. In one tab, run `claude` and start a session.
  2. In the session list, verify that tab shows the Claude logo on its row.
  3. Quit `claude` (Ctrl-D twice).
  4. Verify the logo disappears from that row within ~2 s.

Expected: logo appears and disappears as described.

- [ ] **Step 4: Functional smoke test — fg_cmd**

  1. In one tab, run `bun run tauri dev` (or any long-running command, e.g. `sleep 30`).
  2. Verify the session list shows the foreground command in the relevant row.
  3. Stop the command (Ctrl-C).
  4. Verify the foreground command clears within ~2 s.

Expected: fg_cmd updates as described.

- [ ] **Step 5: Functional smoke test — zombie cleanup**

  1. In one tab, note its PID (`echo $$`).
  2. Close the tab.
  3. Verify the session disappears from the list within ~2 s.

Expected: session is removed.

- [ ] **Step 6: CPU before/after measurement**

  1. Quit Ani-Mime. Launch the **previous** release version (or `git stash` the changes, run `bun run tauri dev`, and observe).
  2. With no terminals doing anything, observe CPU% for the Ani-Mime process in Activity Monitor for 60 s. Record the rough average.
  3. Quit. Launch the **new** build. Repeat the 60 s observation.
  4. Compare. Expectation per spec: ~5–10% → ~1–2%.

Expected: a clear, qualitative drop. Exact numbers depend on the Mac and number of running processes.

- [ ] **Step 7: If anything in steps 2–5 regressed**

Bisect commits with `git bisect` between this branch's tip and `main` to identify which task broke behavior. The four commits should be independently bisectable because each one ends with a green `cargo check`.

If functional behavior is fine but CPU did not drop noticeably, capture a 30 s sample of the Ani-Mime process for analysis:

```bash
# Get pid:
pgrep -x "Ani-Mime"
# Sample for 30 seconds:
sample <pid> 30 -file /tmp/ani-mime-sample.txt
```

Look for time spent inside `proc_scan` / `scan_processes` / `pidinfo`. If most cost is elsewhere (e.g., `tiny_http`, `webview`), the assumption that proc_scan was the dominant cost was wrong and we need to rebrainstorm.

---

## Self-review (filled in by plan author)

- **Spec coverage:** Every change in the spec maps to a task — Task 1 covers spec §1.3 (gate cwd), Task 2 covers spec §1.1 (UID filter), Tasks 3+4 cover spec §1.2 (drop redundant name call). Spec verification section maps to Task 5. Risks section maps to Task 5 step 7 (the "if it didn't drop" branch).
- **Placeholder scan:** No TBD/TODO/"add error handling" left. Every code-touching step contains the exact code. Test code is complete and runnable.
- **Type consistency:** Helper signature is consistent across Task 3 (definition + tests) and Task 4 (call site): `pbi_comm_to_string(&info.pbi_comm)` against `fn pbi_comm_to_string(comm: &[std::os::raw::c_char; 17]) -> String`.
- **No dead refs:** `pids_by_type` and `ProcFilter` imports are added in Task 2. `pbi_comm_to_string` is added in Task 3 and used in Task 4. `geteuid_safe` is added and used in Task 2.
