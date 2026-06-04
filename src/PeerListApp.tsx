import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePeers, type PeerInfo } from "./hooks/usePeers";
import { useNickname } from "./hooks/useNickname";
import { usePet } from "./hooks/usePet";
import { useTheme } from "./hooks/useTheme";
import { useWindowAutoSize } from "./hooks/useWindowAutoSize";
import { useQuickClose } from "./hooks/useQuickClose";
import "./styles/theme.css";
import "./styles/peer-list-window.css";

/** Max length of an outgoing chat message — must match MESSAGE_MAX_LEN in lib.rs. */
const MESSAGE_MAX_LEN = 100;

export function PeerListApp() {
  useQuickClose();
  const peers = usePeers();
  const { nickname } = useNickname();
  const { pet } = usePet();
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [composingPeer, setComposingPeer] = useState<PeerInfo | null>(null);
  const [draft, setDraft] = useState("");
  useTheme();
  useWindowAutoSize(rootRef);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        void win.hide();
      }
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  // Escape: close compose first, then the window if already in list view.
  useEffect(() => {
    const win = getCurrentWindow();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (composingPeer) {
        setComposingPeer(null);
        setDraft("");
        return;
      }
      void win.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composingPeer]);

  // Focus textarea when compose opens.
  useEffect(() => {
    if (!composingPeer) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [composingPeer]);

  const handleVisit = async (peer: PeerInfo) => {
    try {
      await invoke("start_visit", {
        peerId: peer.instance_name,
        nickname,
        pet,
      });
    } catch (err) {
      console.error("[peer-list] start_visit failed:", err);
    } finally {
      void getCurrentWindow().hide();
    }
  };

  const openCompose = (peer: PeerInfo) => {
    setComposingPeer(peer);
    setDraft("");
  };

  const cancelCompose = () => {
    setComposingPeer(null);
    setDraft("");
  };

  const sendMessage = async () => {
    if (!composingPeer) return;
    const msg = draft.trim();
    if (!msg) return;
    try {
      await invoke("start_visit", {
        peerId: composingPeer.instance_name,
        nickname,
        pet,
        message: msg,
      });
    } catch (err) {
      console.error("[peer-list] start_visit with message failed:", err);
    } finally {
      setComposingPeer(null);
      setDraft("");
      void getCurrentWindow().hide();
    }
  };

  return (
    <div ref={rootRef} className="peer-list-shell">
      <div className="peer-list-root" data-testid="peer-list-root">
        {composingPeer ? (
          <ComposeView
            peer={composingPeer}
            draft={draft}
            onDraftChange={setDraft}
            onCancel={cancelCompose}
            onSend={sendMessage}
            textareaRef={textareaRef}
          />
        ) : (
          <>
            <div className="peer-list-header">Mime Around You</div>
            {peers.length === 0 ? (
              <div className="peer-list-empty" data-testid="peer-list-empty">
                <span className="peer-list-empty-title">No peers nearby</span>
                <span className="peer-list-empty-hint">
                  Check Local Network permission
                </span>
              </div>
            ) : (
              <div className="peer-list-items" data-testid="peer-list-items">
                {peers.map((p) => (
                  <div
                    key={p.instance_name}
                    className="peer-list-row-wrap"
                    data-testid={`peer-list-row-${p.instance_name}`}
                  >
                    <div className="peer-list-row">
                      <span className="peer-list-row-dot" aria-hidden="true" />
                      <span className="peer-list-row-main">
                        <span className="peer-list-row-nickname">{p.nickname}</span>
                        <span className="peer-list-row-pet">{p.pet}</span>
                      </span>
                      <button
                        type="button"
                        className="peer-list-row-action"
                        data-testid={`peer-list-visit-${p.instance_name}`}
                        onClick={() => handleVisit(p)}
                        title={`Visit ${p.nickname}`}
                      >
                        visit
                      </button>
                      <button
                        type="button"
                        className="peer-list-row-action message"
                        data-testid={`peer-list-message-${p.instance_name}`}
                        onClick={() => openCompose(p)}
                        aria-label={`Message ${p.nickname}`}
                        title={`Message ${p.nickname}`}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ComposeViewProps {
  peer: PeerInfo;
  draft: string;
  onDraftChange: (s: string) => void;
  onCancel: () => void;
  onSend: () => void | Promise<void>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function ComposeView({
  peer,
  draft,
  onDraftChange,
  onCancel,
  onSend,
  textareaRef,
}: ComposeViewProps) {
  const canSend = draft.trim().length > 0;
  const nearLimit = draft.length >= MESSAGE_MAX_LEN - 10;

  return (
    <div className="peer-compose" data-testid="peer-compose">
      <div className="peer-compose-head">
        <button
          type="button"
          className="peer-compose-back"
          onClick={onCancel}
          aria-label="Back to peer list"
          title="Back"
          data-testid="peer-compose-back"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="peer-compose-target">
          <span className="peer-compose-target-label">to</span>
          <span className="peer-compose-target-name">{peer.nickname}</span>
          <span className="peer-compose-target-pet">({peer.pet})</span>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        className="peer-compose-textarea"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value.slice(0, MESSAGE_MAX_LEN))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void onSend();
          }
        }}
        placeholder="Say something nice..."
        maxLength={MESSAGE_MAX_LEN}
        rows={3}
        data-testid="peer-compose-textarea"
      />

      <div className="peer-compose-footer">
        <span
          className={`peer-compose-count ${nearLimit ? "near-limit" : ""}`}
          data-testid="peer-compose-count"
        >
          {draft.length}/{MESSAGE_MAX_LEN}
        </span>
        <button
          type="button"
          className="peer-compose-cancel"
          onClick={onCancel}
          data-testid="peer-compose-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className="peer-compose-send"
          onClick={() => void onSend()}
          disabled={!canSend}
          data-testid="peer-compose-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}
