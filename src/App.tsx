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
import { useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import "./styles/theme.css";
import "./styles/app.css";

// Extra height to add to the widget window while the fixed-positioned
// session-list dropdown is open. Gives the dropdown room to render
// without being clipped (the dropdown itself is position: fixed so it
// doesn't inflate the container, which means useWindowAutoSize would
// otherwise leave the window at its compact size). 300 = dropdown
// max-height (280px) + top gap (6) + shadow buffer (~14).
const SESSION_DROPDOWN_EXTRA_HEIGHT = 300;
const SESSION_DROPDOWN_MIN_WIDTH = 320;

function App() {
  const { status, scenario } = useStatus();
  const { dragging, onMouseDown } = useDrag();
  const { visible, message, dismiss } = useBubble();
  const visitors = useVisitors();
  const { scale } = useScale();
  const devMode = useDevMode();
  const devAppBounds = useDevAppBounds();
  const devContainerBounds = useDevContainerBounds();
  const devRootBounds = useDevRootBounds();

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
  useTheme();
  useWindowAutoSize(
    containerRef,
    effectActive || sessionOpen || sessionClosing
  );

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
      const newHeight = currentHeight + SESSION_DROPDOWN_EXTRA_HEIGHT;
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
      className={`container ${dragging ? "dragging" : ""} ${scenario ? "scenario-active" : ""} ${devAppBounds ? "dev-bounds" : ""} ${devContainerBounds ? "dev-container-bounds" : ""}`}
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
