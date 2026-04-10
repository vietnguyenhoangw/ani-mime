import { Mascot } from "./components/Mascot";
import { StatusPill } from "./components/StatusPill";
import { SpeechBubble } from "./components/SpeechBubble";
import { VisitorDog } from "./components/VisitorDog";
import { DevTag } from "./components/DevTag";
import { useStatus } from "./hooks/useStatus";
import { useDrag } from "./hooks/useDrag";
import { useTheme } from "./hooks/useTheme";
import { useBubble } from "./hooks/useBubble";
import { useVisitors } from "./hooks/useVisitors";
import { usePeers } from "./hooks/usePeers";
import { useNickname } from "./hooks/useNickname";
import { usePet } from "./hooks/usePet";
import { useScale } from "./hooks/useScale";
import { useDevMode } from "./hooks/useDevMode";
import { useWindowAutoSize } from "./hooks/useWindowAutoSize";
import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import "./styles/theme.css";
import "./styles/app.css";

function App() {
  const { status, scenario } = useStatus();
  const { dragging, onMouseDown } = useDrag();
  const { visible, message, dismiss } = useBubble();
  const visitors = useVisitors();
  const peers = usePeers();
  const { nickname } = useNickname();
  const { pet } = usePet();
  const { scale } = useScale();
  const devMode = useDevMode();
  const containerRef = useRef<HTMLDivElement>(null);
  useTheme();
  useWindowAutoSize(containerRef);

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (status === "visiting") return;

    const items: MenuItem[] = [];

    if (peers.length === 0) {
      const item = await MenuItem.new({
        id: "no-peers",
        text: "No peers nearby \u2014 check Local Network permission",
        enabled: false,
      });
      items.push(item);
    } else {
      for (const peer of peers) {
        const peerId = peer.instance_name;
        const item = await MenuItem.new({
          id: peerId,
          text: `Visit ${peer.nickname} (${peer.pet})`,
          action: async () => {
            try {
              await invoke("start_visit", {
                peerId,
                nickname,
                pet,
              });
            } catch (err) {
              console.error("Visit failed:", err);
            }
          },
        });
        items.push(item);
      }
    }

    const menu = await Menu.new({ items });
    await menu.popup();
  };

  return (
    <div
      ref={containerRef}
      data-testid="app-container"
      className={`container ${dragging ? "dragging" : ""} ${scenario ? "scenario-active" : ""}`}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
    >
      {scenario && <div data-testid="scenario-badge" className="scenario-badge">SCENARIO</div>}
      <SpeechBubble visible={visible} message={message} onDismiss={dismiss} />
      {status !== "visiting" && <Mascot status={status} />}
      {status === "visiting" && <div style={{ width: 128 * scale, height: 128 * scale }} />}
      <StatusPill status={status} glow={visible} />
      {devMode && !scenario && <DevTag />}
      {visitors.map((v, i) => (
        <VisitorDog key={v.nickname} pet={v.pet} nickname={v.nickname} index={i} />
      ))}
    </div>
  );
}

export default App;
