import { Mascot } from "./components/Mascot";
import { StatusPill } from "./components/StatusPill";
import { SpeechBubble } from "./components/SpeechBubble";
import { VisitorDog } from "./components/VisitorDog";
import { DevTag } from "./components/DevTag";
import { DevBuildBadge } from "./components/DevBuildBadge";
import { EffectOverlay } from "./effects";
import { useStatus } from "./hooks/useStatus";
import { useDrag } from "./hooks/useDrag";
import { useTheme } from "./hooks/useTheme";
import { useBubble } from "./hooks/useBubble";
import { useVisitors } from "./hooks/useVisitors";
import { useScale } from "./hooks/useScale";
import { useDevMode } from "./hooks/useDevMode";
import { useDevAppBounds } from "./hooks/useDevAppBounds";
import { useDevContainerBounds } from "./hooks/useDevContainerBounds";
import { useDevRootBounds } from "./hooks/useDevRootBounds";
import { useWindowAutoSize } from "./hooks/useWindowAutoSize";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import "./styles/theme.css";
import "./styles/app.css";

// Total window height while the session-list dropdown is open.
// The dropdown itself is position: fixed so it doesn't inflate the
// container; StatusPill caps the dropdown's max-height to
// (this value - dropdownTop - bottom margin) so long lists scroll
// inside this budget instead of running past the window edge.
const SESSION_DROPDOWN_WINDOW_HEIGHT = 400;
const SESSION_DROPDOWN_MIN_WIDTH = 320;

// Base container padding, duplicated from app.css. Used by the bubble
// window-grow logic to compute how much extra padding the container
// needs so the bubble fits inside the window without clipping.
const BASE_PAD_TOP = 20;
const BASE_PAD_HORIZONTAL = 50; // padding-left + padding-right base
// The bubble overlaps the top 46*scale px of the sprite (see
// speech-bubble.css `bottom` calc). Anything taller than the overlap
// plus the container's base top padding needs extra vertical room.
const BUBBLE_OVERLAP_PX = 46;
// The sprite's native frame width (css px, pre-scale).
const SPRITE_NATIVE_WIDTH = 128;
// Baseline root width — see app.css .container min-width. The bubble
// grow effect only kicks in horizontally when the bubble exceeds this,
// because anything narrower already fits inside the min-width baseline.
const BASELINE_WIDTH = 320;

function App() {
  const { status, scenario } = useStatus();
  const { dragging, onMouseDown } = useDrag();
  const { visible, message, dismiss } = useBubble();
  const visitors = useVisitors();
  const { scale } = useScale();
  const devMode = useDevMode();
  const appBoundsToggle = useDevAppBounds();
  const containerBoundsToggle = useDevContainerBounds();
  const rootBoundsToggle = useDevRootBounds();
  // Outline visibility is gated behind dev mode so the outlines never
  // show for normal users: toggling them individually in the Superpower
  // tool is only meaningful while dev mode is active. If dev mode is
  // ever turned off, all three outlines hide regardless of their
  // individual toggle state.
  const devAppBounds = devMode && appBoundsToggle;
  const devContainerBounds = devMode && containerBoundsToggle;
  const devRootBounds = devMode && rootBoundsToggle;

  // #root lives in the HTML template outside React's tree, so we toggle
  // its class imperatively when the dev toggle flips.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.classList.toggle("dev-root-bounds", devRootBounds);
  }, [devRootBounds]);
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
  // Extra padding the container needs so a multi-line / wide bubble
  // fits inside the window without clipping. Driven by a ResizeObserver
  // on the bubble; applied via CSS vars on .container.
  const [bubbleExtra, setBubbleExtra] = useState<{ top: number; horizontal: number }>({ top: 0, horizontal: 0 });
  // Window position recorded at the moment the bubble first starts
  // growing the window, used to restore position on hide.
  const bubbleSavedPosRef = useRef<LogicalPosition | null>(null);
  // True while our bubble effect owns the window geometry — pauses
  // useWindowAutoSize so it doesn't race our setSize/setPosition.
  const bubbleGrowActive = visible && (bubbleExtra.top > 0 || bubbleExtra.horizontal > 0);
  useTheme();
  // Pause useWindowAutoSize while visitors are present — the visitor
  // effect below owns the window size in that mode (fixed 500 wide)
  // and useWindowAutoSize would otherwise shrink back to whatever
  // container.offsetWidth reports.
  useWindowAutoSize(
    containerRef,
    effectActive || sessionOpen || sessionClosing || bubbleGrowActive || visitors.length > 0
  );

  // Measure the rendered speech bubble (via ResizeObserver) and compute
  // how much extra container padding is needed so the bubble fits
  // inside the window. Extras are applied via CSS variables (see
  // `.container` in app.css) so `container.offsetWidth/offsetHeight`
  // reflects the new size — that's what the window-grow effect reads
  // to compute the setSize target.
  useLayoutEffect(() => {
    if (!visible) {
      setBubbleExtra((prev) =>
        prev.top === 0 && prev.horizontal === 0 ? prev : { top: 0, horizontal: 0 }
      );
      return;
    }

    const el = document.querySelector<HTMLDivElement>('[data-testid="speech-bubble"]');
    if (!el) return;

    const recompute = () => {
      const rect = el.getBoundingClientRect();
      // Horizontal: container is centered (justify-content: center) and
      // guaranteed BASELINE_WIDTH by min-width, so any bubble that fits
      // within 320px needs zero extras. For wider bubbles we add enough
      // padding to push `content + padding` past min-width and match
      // the bubble's actual width, split evenly across both sides.
      const extraH =
        rect.width > BASELINE_WIDTH
          ? Math.max(
              0,
              Math.ceil(
                (rect.width - SPRITE_NATIVE_WIDTH * scale - BASE_PAD_HORIZONTAL) / 2
              )
            )
          : 0;
      // Vertical: bubble bottom is at BUBBLE_OVERLAP_PX * scale below
      // the mascot top. Budget above = overlap + BASE_PAD_TOP.
      const extraTop = Math.max(
        0,
        Math.ceil(rect.height - BUBBLE_OVERLAP_PX * scale - BASE_PAD_TOP)
      );
      setBubbleExtra((prev) =>
        prev.top === extraTop && prev.horizontal === extraH
          ? prev
          : { top: extraTop, horizontal: extraH }
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, scale]);

  // Grow the window around the bubble so it doesn't clip at the window
  // edge, and keep the sprite visually anchored by shifting window
  // position by the same deltas. Mirrors the session-dropdown pattern
  // above; skipped while the session is resizing the window so the
  // two effects don't fight.
  useEffect(() => {
    if (sessionOpen || sessionClosing) return;

    const win = getCurrentWindow();
    const { top: extraTop, horizontal: extraH } = bubbleExtra;
    const shouldGrow = visible && (extraTop > 0 || extraH > 0);

    if (shouldGrow) {
      void (async () => {
        try {
          const el = containerRef.current;
          if (!el) return;

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
          const newWidth = el.offsetWidth;
          const newHeight = el.offsetHeight;

          await Promise.all([
            win.setPosition(
              new LogicalPosition(savedPos.x - extraH, savedPos.y - extraTop)
            ),
            win.setSize(new LogicalSize(newWidth, newHeight)),
          ]);
        } catch (err) {
          console.error("[bubble-grow] resize failed:", err);
        }
      })();
      return;
    }

    if (bubbleSavedPosRef.current) {
      const savedPos = bubbleSavedPosRef.current;
      bubbleSavedPosRef.current = null;
      void (async () => {
        try {
          const el = containerRef.current;
          const ops: Promise<void>[] = [win.setPosition(savedPos)];
          if (el) {
            ops.push(
              win.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight))
            );
          }
          await Promise.all(ops);
        } catch (err) {
          console.error("[bubble-grow] restore failed:", err);
        }
      })();
    }
  }, [visible, bubbleExtra, sessionOpen, sessionClosing]);

  // Visitor count change → drive the window size directly.
  //
  // With visitors: window fixed at 500 wide × max(250, content-height).
  // Without visitors: hand control back to useWindowAutoSize, which
  // will resize to container.offsetWidth (>= 320 via min-width) on
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
  // On the last visitor leaving, restore the saved position and let
  // the container's natural (min-width 320) size take over via setSize.
  useEffect(() => {
    const win = getCurrentWindow();

    if (visitors.length > 0) {
      const el = containerRef.current;
      if (!el) return;
      const currentWidth = el.offsetWidth;
      const currentHeight = el.offsetHeight;
      const newWidth = 500;
      const newHeight = Math.max(250, currentHeight);
      const dx = newWidth - currentWidth;

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
        const el = containerRef.current;
        const ops: Promise<void>[] = [win.setPosition(savedPos)];
        if (el) {
          ops.push(
            win.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight))
          );
        }
        await Promise.all(ops);
      } catch (err) {
        console.error("[visitors] restore failed:", err);
      }
    })();
  }, [visitors.length]);

  // When the dropdown opens the window grows wider (>= SESSION_DROPDOWN_MIN_WIDTH).
  // Because #root centers its content, a wider window visibly shifts the
  // pet + pill rightward. To keep the pet visually anchored we also move
  // the window left by half the width growth. On close we restore both
  // size and position so the pet returns to its original spot.
  //
  // setSize + setPosition are fired in parallel via Promise.all so they
  // commit close to the same native-window frame — otherwise the
  // sequential awaits make one change visible before the other and the
  // pet flickers between positions.
  useEffect(() => {
    const win = getCurrentWindow();

    if (sessionOpen) {
      const el = containerRef.current;
      if (!el) return;
      const currentWidth = el.offsetWidth;
      const currentHeight = el.offsetHeight;
      const newWidth = Math.max(currentWidth, SESSION_DROPDOWN_MIN_WIDTH);
      // Cap total window height at SESSION_DROPDOWN_WINDOW_HEIGHT (400).
      // Uses max() so taller pre-existing content (e.g. a multi-line
      // bubble) keeps its height rather than being squeezed.
      const newHeight = Math.max(currentHeight, SESSION_DROPDOWN_WINDOW_HEIGHT);
      const dx = newWidth - currentWidth;

      void (async () => {
        try {
          const scale = await win.scaleFactor();
          const pos = await win.outerPosition();
          const logical = pos.toLogical(scale);
          const origX = Math.round(logical.x);
          const origY = Math.round(logical.y);
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

    const savedPos = savedPosRef.current;
    if (!savedPos) {
      // Nothing to revert — make sure we don't leave sessionClosing
      // stuck true (onOpenChange flipped it optimistically).
      setSessionClosing(false);
      return;
    }
    savedPosRef.current = null;

    void (async () => {
      try {
        const el = containerRef.current;
        const ops: Promise<void>[] = [win.setPosition(savedPos)];
        if (el) {
          ops.push(
            win.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight))
          );
        }
        await Promise.all(ops);
      } catch (err) {
        console.error("[session-dropdown] close resize failed:", err);
      } finally {
        setSessionClosing(false);
      }
    })();
  }, [sessionOpen]);

  return (
    <div
      ref={containerRef}
      data-testid="app-container"
      className={`container ${dragging ? "dragging" : ""} ${scenario ? "scenario-active" : ""} ${visitors.length > 0 ? "has-visitors" : ""} ${devAppBounds ? "dev-bounds" : ""} ${devContainerBounds ? "dev-container-bounds" : ""}`}
      style={{
        // Driven by the bubble measurement effect above. 0 when the
        // bubble is hidden or fits in the default padding.
        "--bubble-extra-top": `${bubbleExtra.top}px`,
        "--bubble-extra-h": `${bubbleExtra.horizontal}px`,
        // Enforced inline (as well as via .has-visitors CSS rule) to
        // guarantee the highest specificity wins: whichever stylesheet
        // ordering or hot-reload state we're in, the min-width here
        // is authoritative.
        minWidth: visitors.length > 0 ? "500px" : "320px",
        minHeight: "250px",
      } as React.CSSProperties}
      onMouseDown={onMouseDown}
    >
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
        {devMode && <DevTag />}
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
    </div>
  );
}

export default App;
