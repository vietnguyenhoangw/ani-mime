import { Mascot } from "./components/Mascot";
import { StatusPill } from "./components/StatusPill";
import { MiniBar } from "./components/MiniBar";
import { useMiniMode } from "./hooks/useMiniMode";
import { SpeechBubble } from "./components/SpeechBubble";
import { VisitorDog } from "./components/VisitorDog";
import { DevTag } from "./components/DevTag";
import { DevBuildBadge } from "./components/DevBuildBadge";
import { EffectOverlay } from "./effects";
import { useStatus } from "./hooks/useStatus";
import { useDrag } from "./hooks/useDrag";
import { useTheme } from "./hooks/useTheme";
import { useBubble, LONG_BUBBLE_THRESHOLD } from "./hooks/useBubble";
import { useVisitors } from "./hooks/useVisitors";
import { useScale } from "./hooks/useScale";
import { useDevMode } from "./hooks/useDevMode";
import { useDevTagVisible } from "./hooks/useDevTagVisible";
import { useDevAppBounds } from "./hooks/useDevAppBounds";
import { useDevContainerBounds } from "./hooks/useDevContainerBounds";
import { useDevRootBounds } from "./hooks/useDevRootBounds";
import {
  PET_BASE_WIDTH,
  PET_BASE_HEIGHT,
  getDefaultPetSize,
  useWindowDefaultSize,
} from "./hooks/useWindowDefaultSize";
import { useSoundSettings } from "./hooks/useSoundSettings";
import { useSoundOverrides } from "./hooks/useSoundOverrides";
import { useCustomSounds } from "./hooks/useCustomSounds";
import { findStatusCase, findVisitCase, resolveSound, playResolvedSound } from "./constants/sounds";
import { stopAudio } from "./utils/audio";
import type { Status } from "./types/status";
import { useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import { InstallPromptDialog } from "./components/InstallPromptDialog";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/install-prompt.css";

// Total window height while the session-list dropdown is open.
// The dropdown itself is position: fixed so it doesn't inflate the
// container; StatusPill caps the dropdown's max-height to
// (this value - dropdownTop - bottom margin) so long lists scroll
// inside this budget instead of running past the window edge.
const SESSION_DROPDOWN_WINDOW_HEIGHT = 400;
const SESSION_DROPDOWN_MIN_WIDTH = 320;


/**
 * Map a status transition to the id of the sound case it should trigger.
 * Returns null when no sound should fire (no change, or coming from
 * "initializing" which is treated as silent startup).
 */
function transitionToCaseId(prev: Status, next: Status): string | null {
  if (prev === next) return null;
  if (prev === "initializing") return null;
  if (next === "busy" && prev !== "busy") return "working";
  if (prev === "busy" && next !== "busy") return "done";
  // For all other transitions the case id matches the status name
  // (idle/searching/service/disconnected/visiting).
  return next;
}

function App() {
  const { prompt, error: installError, clear } = useInstallPrompt();
  const { status, scenario } = useStatus();
  const { visible, message, dismiss } = useBubble();
  const visitors = useVisitors();
  const { scale } = useScale();
  const mini = useMiniMode(scale);
  // Pet mode: drag the pet anywhere. Mini mode: the container does NOT drag —
  // the bar is edge-docked and moved only via the grip (mini.startEdgeDrag).
  const { dragging, onMouseDown } = useDrag();
  const devMode = useDevMode();
  const devTagToggle = useDevTagVisible();
  const appBoundsToggle = useDevAppBounds();
  const containerBoundsToggle = useDevContainerBounds();
  const rootBoundsToggle = useDevRootBounds();
  // Outline visibility is gated behind dev mode so the outlines never
  // show for normal users: toggling them individually in the Superpower
  // tool is only meaningful while dev mode is active. If dev mode is
  // ever turned off, all three outlines hide regardless of their
  // individual toggle state.
  const devTagVisible = devMode && devTagToggle;
  const devAppBounds = devMode && appBoundsToggle;
  const devContainerBounds = devMode && containerBoundsToggle;
  const devRootBounds = devMode && rootBoundsToggle;
  const sound = useSoundSettings();
  const { overrides: soundOverrides } = useSoundOverrides();
  const { getSoundUrl } = useCustomSounds();

  // #root lives in the HTML template outside React's tree, so we toggle
  // its class imperatively when the dev toggle flips.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.classList.toggle("dev-root-bounds", devRootBounds);
  }, [devRootBounds]);

  // Ring the doorbell when a peer's dog arrives. Compares against the
  // previous visitor count so we only fire on growth (arrivals), not on
  // departures or initial mount when the list is already populated.
  const prevVisitorCountRef = useRef(visitors.length);
  useEffect(() => {
    if (visitors.length > prevVisitorCountRef.current && sound.isCategoryEnabled("visit")) {
      const c = findVisitCase("visitor-arrived");
      const resolved = c ? resolveSound(c, soundOverrides) : null;
      if (c && resolved) void playResolvedSound(resolved, c.playOptions, getSoundUrl);
    }
    prevVisitorCountRef.current = visitors.length;
  }, [visitors.length, sound.master, sound.visit, soundOverrides, getSoundUrl]);

  // Working-status audio: loop the working sound while busy, play the
  // done sound once when the task finishes (busy → anything else).
  // Every transition maps to a case id whose sound is resolved through
  // the override map — lets users swap or silence any specific case.
  const busyLoopRef = useRef<HTMLAudioElement | null>(null);
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    const statusEnabled = sound.isCategoryEnabled("status");

    // If status sounds (or master) got disabled mid-loop, cut it
    // immediately rather than waiting for the busy→idle transition.
    if (!statusEnabled && busyLoopRef.current) {
      stopAudio(busyLoopRef.current);
      busyLoopRef.current = null;
    }

    if (!statusEnabled) return;

    const caseId = transitionToCaseId(prev, status);
    if (!caseId) return;
    const c = findStatusCase(caseId);
    if (!c) return;
    const resolved = resolveSound(c, soundOverrides);

    if (caseId === "working") {
      if (resolved) {
        const shouldLoop = sound.workingLoop;
        void playResolvedSound(
          resolved,
          { ...c.playOptions, loop: shouldLoop },
          getSoundUrl
        ).then((el) => {
          // Only track the element if we actually looped — a one-shot
          // working sound ends on its own and doesn't need stopping on
          // the busy→idle transition.
          busyLoopRef.current = shouldLoop ? el : null;
        });
      }
    } else if (caseId === "done") {
      stopAudio(busyLoopRef.current);
      busyLoopRef.current = null;
      if (resolved) void playResolvedSound(resolved, c.playOptions, getSoundUrl);
    } else if (resolved) {
      void playResolvedSound(resolved, c.playOptions, getSoundUrl);
    }
  }, [status, sound.master, sound.status, sound.workingLoop, soundOverrides, getSoundUrl]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [effectActive, setEffectActive] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  // Stays true from the moment the dropdown starts closing until the
  // window has been fully resized and repositioned. Keeps
  // useWindowAutoSize paused across the whole transition so it can't
  // race this effect with its own setSize (which would otherwise flash
  // the content at the wrong position for a frame).
  const [sessionClosing, setSessionClosing] = useState(false);
  // Window position captured when the dropdown opens, restored on close.
  // Keeping this as a ref avoids triggering a re-render when we record it.
  const savedPosRef = useRef<LogicalPosition | null>(null);
  // Window position recorded at the moment the bubble first grows the
  // window, used to restore position on hide.
  const bubbleSavedPosRef = useRef<LogicalPosition | null>(null);
  // True whenever a long-text bubble is on screen — its window upsize
  // must pause the default-size hook.
  const bubbleGrowActive = visible && message.length > LONG_BUBBLE_THRESHOLD;
  useTheme();
  // The pet window snaps to a fixed PET_BASE × scale by default. Each
  // trigger effect below explicitly grows the window and pauses this
  // hook; on deactivate the trigger restores size+position back to the
  // default and this hook re-fires to confirm.
  useWindowDefaultSize(
    scale,
    mini.mode === "mini" ||
      effectActive ||
      sessionOpen ||
      sessionClosing ||
      bubbleGrowActive ||
      visitors.length > 0
  );

  // Bubble orchestration: every source funnels through useBubble's
  // pending queue. Here we decide based on text length whether to upsize
  // the window FIRST, then call consume() to actually display the
  // bubble. Short text → consume immediately; long text → grow window
  // to session-list size, then consume. Skipped while the session list
  // already owns a grown window so the two effects don't fight.
  // Bubble window-grow — VERBATIM mirror of the session-list pattern
  // (see the sessionOpen effect below). When `bubbleGrowActive` flips
  // true (a long-text bubble appears), grow the window exactly the way
  // the dropdown does. When it flips false (bubble hidden, dismissed,
  // or replaced by a short message), restore size + position.
  useEffect(() => {
    // Skip ONLY when the session list is actively open (it owns the
    // grown window). Don't skip during sessionClosing — it's an
    // unreliable transient flag and using it here was making the bubble
    // grow effect exit early when it shouldn't.
    if (mini.mode === "mini") return;
    if (sessionOpen) return;
    const win = getCurrentWindow();
    const def = getDefaultPetSize(scale);

    if (bubbleGrowActive) {
      const newWidth = Math.max(def.width, SESSION_DROPDOWN_MIN_WIDTH);
      const newHeight = Math.max(def.height, SESSION_DROPDOWN_WINDOW_HEIGHT);
      const dx = newWidth - def.width;

      void (async () => {
        try {
          // CRITICAL: save the original position only ONCE. The effect
          // re-runs whenever sessionOpen or sessionClosing flips (which
          // can happen multiple times while a long bubble is showing),
          // and saving on every run captures the already-shifted window
          // as the new "original" — each subsequent grow then shifts
          // 80px further left. Save once → all re-runs are idempotent.
          if (!bubbleSavedPosRef.current) {
            const sf = await win.scaleFactor();
            const pos = await win.outerPosition();
            const logical = pos.toLogical(sf);
            bubbleSavedPosRef.current = new LogicalPosition(
              Math.round(logical.x),
              Math.round(logical.y)
            );
          }
          const savedPos = bubbleSavedPosRef.current;
          await Promise.all([
            win.setPosition(
              new LogicalPosition(
                savedPos.x - Math.round(dx / 2),
                savedPos.y
              )
            ),
            win.setSize(new LogicalSize(newWidth, newHeight)),
          ]);
        } catch (err) {
          console.error("[bubble-grow] open resize failed:", err);
        }
      })();
      return;
    }

    const savedPos = bubbleSavedPosRef.current;
    if (!savedPos) return;
    bubbleSavedPosRef.current = null;

    void (async () => {
      try {
        await Promise.all([
          win.setPosition(savedPos),
          win.setSize(new LogicalSize(def.width, def.height)),
        ]);
      } catch (err) {
        console.error("[bubble-grow] close resize failed:", err);
      }
    })();
  }, [bubbleGrowActive, sessionOpen, scale, mini.mode]);

  // Visitor count change → drive the window size directly.
  //
  // With visitors: window fixed at 500 wide × max(190, content-height).
  // Without visitors: hand control back to useWindowAutoSize, which
  // will resize to container.offsetWidth (>= 150 via min-width) on
  // its next ResizeObserver tick.
  //
  // requestAnimationFrame waits one frame so React/CSS have committed
  // the new layout (visitor-col mounted/unmounted) before we measure.
  // Saved position when visitor mode grows the window, restored on
  // last-visitor-leaves. Parallel to savedPosRef used by the session
  // dropdown effect.
  const visitorSavedPosRef = useRef<LogicalPosition | null>(null);

  // When visitors arrive, grow the window to 500px wide and shift it
  // left by half the delta so the sprite stays visually anchored —
  // same pattern the session-dropdown effect uses for its own resize.
  // Grow to 500 wide for visitor mode, then restore to default on the
  // last visitor leaving.
  useEffect(() => {
    if (mini.mode === "mini") return;
    const win = getCurrentWindow();
    const def = getDefaultPetSize(scale);

    if (visitors.length > 0) {
      const newWidth = 500;
      const newHeight = def.height;
      const dx = newWidth - def.width;

      void (async () => {
        try {
          const sf = await win.scaleFactor();
          const pos = await win.outerPosition();
          const logical = pos.toLogical(sf);
          const origX = Math.round(logical.x);
          const origY = Math.round(logical.y);
          if (!visitorSavedPosRef.current) {
            visitorSavedPosRef.current = new LogicalPosition(origX, origY);
          }
          await Promise.all([
            win.setPosition(
              new LogicalPosition(origX - Math.round(dx / 2), origY)
            ),
            win.setSize(new LogicalSize(newWidth, newHeight)),
          ]);
        } catch (err) {
          console.error("[visitors] grow failed:", err);
        }
      })();
      return;
    }

    // Restore path
    const savedPos = visitorSavedPosRef.current;
    if (!savedPos) return;
    visitorSavedPosRef.current = null;

    void (async () => {
      try {
        await Promise.all([
          win.setPosition(savedPos),
          win.setSize(new LogicalSize(def.width, def.height)),
        ]);
      } catch (err) {
        console.error("[visitors] restore failed:", err);
      }
    })();
  }, [visitors.length, scale, mini.mode]);

  // When the dropdown opens the window grows wider (>= SESSION_DROPDOWN_MIN_WIDTH).
  // Because #root centers its content, a wider window visibly shifts the
  // pet + pill rightward. To keep the pet visually anchored we also move
  // the window left by half the width growth. On close we shrink it back
  // and inverse-shift the CURRENT position right by dx/2 — using the
  // current position (not the open-time saved one) means any drag the
  // user did while the dropdown was open is preserved across the close.
  //
  // setSize + setPosition are fired in parallel via Promise.all so they
  // commit close to the same native-window frame — otherwise the
  // sequential awaits make one change visible before the other and the
  // pet flickers between positions.
  useEffect(() => {
    if (mini.mode === "mini") return;
    const win = getCurrentWindow();
    const def = getDefaultPetSize(scale);
    const newWidth = Math.max(def.width, SESSION_DROPDOWN_MIN_WIDTH);
    const dx = newWidth - def.width;

    if (sessionOpen) {
      const newHeight = Math.max(def.height, SESSION_DROPDOWN_WINDOW_HEIGHT);

      void (async () => {
        try {
          const sf = await win.scaleFactor();
          const pos = await win.outerPosition();
          const logical = pos.toLogical(sf);
          const origX = Math.round(logical.x);
          const origY = Math.round(logical.y);
          // Sentinel so the close branch knows we actually opened. The
          // value isn't restored — we read the current position on close
          // to preserve any user drag.
          savedPosRef.current = new LogicalPosition(origX, origY);
          await Promise.all([
            win.setPosition(
              new LogicalPosition(origX - Math.round(dx / 2), origY)
            ),
            win.setSize(new LogicalSize(newWidth, newHeight)),
          ]);
        } catch (err) {
          console.error("[session-dropdown] open resize failed:", err);
        }
      })();
      return;
    }

    if (!savedPosRef.current) {
      setSessionClosing(false);
      return;
    }
    savedPosRef.current = null;

    void (async () => {
      try {
        const sf = await win.scaleFactor();
        const pos = await win.outerPosition();
        const logical = pos.toLogical(sf);
        const curX = Math.round(logical.x);
        const curY = Math.round(logical.y);
        await Promise.all([
          win.setPosition(
            new LogicalPosition(curX + Math.round(dx / 2), curY)
          ),
          win.setSize(new LogicalSize(def.width, def.height)),
        ]);
      } catch (err) {
        console.error("[session-dropdown] close resize failed:", err);
      } finally {
        setSessionClosing(false);
      }
    })();
  }, [sessionOpen, scale, mini.mode]);

  return (
    <>
    <div
      ref={containerRef}
      data-testid="app-container"
      className={`container ${mini.mode === "mini" ? "mini-mode" : ""} ${dragging ? "dragging" : ""} ${scenario ? "scenario-active" : ""} ${visitors.length > 0 ? "has-visitors" : ""} ${devAppBounds ? "dev-bounds" : ""} ${devContainerBounds ? "dev-container-bounds" : ""}`}
      style={{
        // Enforced inline (as well as via .has-visitors CSS rule) to
        // guarantee the highest specificity wins: whichever stylesheet
        // ordering or hot-reload state we're in, the min-width here
        // is authoritative.
        minWidth:
          mini.mode === "mini"
            ? undefined
            : visitors.length > 0
              ? "500px"
              : `${PET_BASE_WIDTH}px`,
        minHeight: mini.mode === "mini" ? undefined : `${PET_BASE_HEIGHT}px`,
      }}
      onMouseDown={mini.mode === "mini" ? undefined : onMouseDown}
    >
      {mini.mode === "mini" ? (
        <MiniBar
          status={status}
          orientation={mini.orientation}
          edge={mini.edge}
          onGripMouseDown={mini.startEdgeDrag}
          onRestore={mini.exitMini}
        />
      ) : (
        <>
      <div className="main-col">
        {scenario && <div data-testid="scenario-badge" className="scenario-badge">SCENARIO</div>}
        <EffectOverlay onActiveChange={setEffectActive} />
        {/* mascot-wrap anchors the absolute-positioned speech bubble.
            Keeping the bubble out of the flex flow prevents it from
            nudging the sprite's Y position when it appears/disappears. */}
        <div className="mascot-wrap">
          <SpeechBubble visible={visible} message={message} onDismiss={dismiss} />
          {status !== "visiting" && <Mascot status={status} />}
          {status === "visiting" && <div style={{ width: 128 * scale, height: 128 * scale }} />}
        </div>
        <DevBuildBadge />
        <StatusPill
          status={status}
          glow={visible}
          disabled={status === "visiting"}
          onMinimize={mini.enterMini}
          onOpenChange={(open) => {
            // Flip sessionClosing to true in the SAME render batch that
            // sessionOpen becomes false — this keeps useWindowAutoSize
            // paused across the whole close transition, otherwise its
            // effect re-runs synchronously with paused=false and fires
            // an extra setSize that flashes the content at the wrong
            // position for a frame.
            if (!open) setSessionClosing(true);
            setSessionOpen(open);
          }}
        />
        {devTagVisible && <DevTag />}
      </div>
      {visitors.length > 0 && (
        <div className="visitors-col" data-testid="visitors-col">
          {visitors.map((v, i) => (
            <VisitorDog
              key={v.instance_name || v.nickname || `${i}`}
              pet={v.pet}
              nickname={v.nickname}
              message={v.message}
              index={i}
            />
          ))}
        </div>
      )}
        </>
      )}
    </div>
    <InstallPromptDialog prompt={prompt} error={installError} onDone={clear} />
    </>
  );
}

export default App;
