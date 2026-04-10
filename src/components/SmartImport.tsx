import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { info, error as logError } from "@tauri-apps/plugin-log";
import type { Status } from "../types/status";
import {
  loadImage,
  prepareCanvas,
  detectRows,
  extractFrames,
  getFramePreview,
  createStripFromFrames,
  type Frame,
  type BgColor,
} from "../utils/spriteSheetProcessor";
import { ALL_STATUSES } from "../hooks/useCustomMimes";

interface SmartImportProps {
  onSave: (name: string, blobs: Record<Status, { blob: Uint8Array; frames: number }>) => Promise<void>;
  onCancel: () => void;
}

const STATUS_LABELS: Record<Status, string> = {
  idle: "Idle",
  busy: "Busy",
  service: "Service",
  disconnected: "Disconnected",
  searching: "Searching",
  initializing: "Initializing",
  visiting: "Visiting",
};

const STATUS_DESCRIPTIONS: Record<Status, string> = {
  idle: "No commands running — the default resting state",
  busy: "A terminal command is actively running",
  service: "A long-running process (e.g. dev server) is active",
  disconnected: "No terminal sessions connected",
  searching: "App just launched, looking for terminal sessions",
  initializing: "First-launch setup in progress",
  visiting: "A friend's mime is visiting from the local network",
};

/** Parse "1-5" or "1,2,3,5,6" into 0-based indices. Returns sorted unique indices. */
function parseFrameInput(input: string, maxFrame: number): number[] {
  const indices = new Set<number>();
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.split("-");
    if (range.length === 2) {
      const start = parseInt(range[0]);
      const end = parseInt(range[1]);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(maxFrame, end); i++) {
          indices.add(i - 1); // convert to 0-based
        }
      }
    } else {
      const n = parseInt(trimmed);
      if (!isNaN(n) && n >= 1 && n <= maxFrame) {
        indices.add(n - 1);
      }
    }
  }
  return [...indices].sort((a, b) => a - b);
}

export function SmartImport({ onSave, onCancel }: SmartImportProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [frameInputs, setFrameInputs] = useState<Record<Status, string>>(() => {
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = "";
    return init;
  });
  const [previewFrames, setPreviewFrames] = useState<Record<Status, string[]>>(() => {
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = [];
    return init;
  });
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [bgColor, setBgColor] = useState<BgColor | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [allFramePreviews, setAllFramePreviews] = useState<string[]>([]);

  const handlePickSheet = useCallback(async () => {
    setError(null);
    try {
      const result = await open({
        multiple: false,
        filters: [{ name: "Sprite Sheet", extensions: ["png", "gif", "jpg", "jpeg"] }],
      });
      if (!result) return;

      setFileName(result.split("/").pop() ?? "");
      const bytes = await readFile(result);
      const ext = result.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "gif" ? "image/gif" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      const blob = new Blob([bytes], { type: mime });
      const src = URL.createObjectURL(blob);
      const img = await loadImage(src);
      URL.revokeObjectURL(src);
      setImgElement(img);
      const { canvas: prepared, bgColor: detectedBg } = prepareCanvas(img);
      setBgColor(detectedBg);
      setCanvas(prepared);

      const detected = detectRows(prepared);
      if (detected.length === 0) {
        setError("No sprite rows detected. Try a different image or background color.");
        return;
      }

      const allFrames = extractFrames(detected);
      setFrames(allFrames);

      // Auto-assign: distribute frames evenly across statuses
      const perStatus = Math.max(1, Math.floor(allFrames.length / ALL_STATUSES.length));
      const autoInputs: Record<string, string> = {};
      const autoPreviews: Record<string, string[]> = {};
      for (let si = 0; si < ALL_STATUSES.length; si++) {
        const start = si * perStatus + 1;
        const end = si === ALL_STATUSES.length - 1
          ? allFrames.length
          : Math.min((si + 1) * perStatus, allFrames.length);
        autoInputs[ALL_STATUSES[si]] = `${start}-${end}`;
        const indices = parseFrameInput(`${start}-${end}`, allFrames.length);
        autoPreviews[ALL_STATUSES[si]] = indices.map((i) => getFramePreview(prepared, allFrames[i]));
      }
      setFrameInputs(autoInputs as Record<Status, string>);
      setPreviewFrames(autoPreviews as Record<Status, string[]>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load image";
      logError(`[smart-import] handlePickSheet failed: ${msg}`);
      setError(msg);
    }
  }, []);

  const reprocessWithColor = useCallback((newColor: BgColor) => {
    if (!imgElement) return;
    setBgColor(newColor);
    const { canvas: prepared } = prepareCanvas(imgElement, newColor);
    setCanvas(prepared);

    const detected = detectRows(prepared);
    const allFrames = extractFrames(detected);
    setFrames(allFrames);

    // Reset inputs
    const resetInputs: Record<string, string> = {};
    const resetPreviews: Record<string, string[]> = {};
    for (const s of ALL_STATUSES) {
      resetInputs[s] = "";
      resetPreviews[s] = [];
    }
    setFrameInputs(resetInputs as Record<Status, string>);
    setPreviewFrames(resetPreviews as Record<Status, string[]>);
    setAllFramePreviews([]);
  }, [imgElement]);

  const handlePreview = useCallback((status: Status) => {
    if (!canvas || frames.length === 0) return;
    const indices = parseFrameInput(frameInputs[status], frames.length);
    const previews = indices.map((i) => getFramePreview(canvas, frames[i]));
    setPreviewFrames((prev) => ({ ...prev, [status]: previews }));
  }, [canvas, frames, frameInputs]);

  const handleShowAllFrames = useCallback(() => {
    if (!canvas || frames.length === 0) return;
    if (allFramePreviews.length === 0) {
      const previews = frames.map((f) => getFramePreview(canvas, f));
      setAllFramePreviews(previews);
    }
    setShowModal(true);
  }, [canvas, frames, allFramePreviews]);

  const allStatusesAssigned = ALL_STATUSES.every((s) => {
    const indices = parseFrameInput(frameInputs[s], frames.length);
    return indices.length > 0;
  });

  const handleSave = useCallback(async () => {
    if (!canvas || !name.trim() || !allStatusesAssigned) return;
    setProcessing(true);
    setError(null);

    try {
      info(`[smart-import] saving mime "${name}" with ${ALL_STATUSES.length} statuses`);
      const blobs: Record<string, { blob: Uint8Array; frames: number }> = {};

      for (const status of ALL_STATUSES) {
        const indices = parseFrameInput(frameInputs[status], frames.length);
        const strip = await createStripFromFrames(canvas, frames, indices);
        blobs[status] = strip;
      }

      await onSave(name.trim(), blobs as Record<Status, { blob: Uint8Array; frames: number }>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save mime";
      logError(`[smart-import] handleSave failed: ${msg}`);
      setError(msg);
    } finally {
      setProcessing(false);
    }
  }, [canvas, name, allStatusesAssigned, frameInputs, frames, onSave]);

  return (
    <div className="smart-import">
      {error && (
        <div className="smart-import-error">{error}</div>
      )}
      {!canvas ? (
        <div className="smart-import-pick">
          <div className="settings-card">
            <div className="smart-import-dropzone" onClick={handlePickSheet}>
              <div className="add-icon" style={{ fontSize: 32 }}>+</div>
              <span>Choose a sprite sheet</span>
              <span className="smart-import-hint">PNG, GIF, or JPG</span>
            </div>
          </div>
          <div className="custom-creator-actions">
            <button className="creator-btn cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-card" style={{ marginBottom: 10 }}>
            <div className="settings-row">
              <span className="settings-row-label">Name</span>
              <input
                type="text"
                className="settings-input"
                style={{ textAlign: "right" }}
                value={name}
                placeholder="My Custom Mime"
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="settings-row">
              <span className="settings-row-label">File</span>
              <span className="smart-import-file">{fileName}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Frames</span>
              <div className="smart-import-frames-info">
                <span className="smart-import-file">{frames.length} detected</span>
                <button className="smart-import-show-all-btn" onClick={handleShowAllFrames}>
                  Show all
                </button>
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Background</span>
              <div className="smart-import-bg-picker">
                {bgColor && (
                  <>
                    <div
                      className="smart-import-bg-swatch"
                      style={{ backgroundColor: `rgb(${bgColor.r},${bgColor.g},${bgColor.b})` }}
                    />
                    <span className="smart-import-bg-hex">
                      #{bgColor.r.toString(16).padStart(2, "0")}{bgColor.g.toString(16).padStart(2, "0")}{bgColor.b.toString(16).padStart(2, "0")}
                    </span>
                  </>
                )}
                <select
                  className="smart-import-select"
                  value=""
                  onChange={(e) => {
                    const hex = e.target.value;
                    if (!hex) return;
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    reprocessWithColor({ r, g, b });
                  }}
                >
                  <option value="">Change...</option>
                  <option value="#00B800">Green</option>
                  <option value="#FF00FF">Magenta</option>
                  <option value="#0000FF">Blue</option>
                  <option value="#000000">Black</option>
                  <option value="#FFFFFF">White</option>
                </select>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="smart-import-rows-header">
              <span className="settings-row-label">Assign frames to states</span>
              <span className="smart-import-hint">e.g. 1-5 or 1,2,3,5,6</span>
            </div>
            {ALL_STATUSES.map((status) => (
              <div className="smart-import-frame-assign" key={status}>
                <div className="smart-import-frame-header">
                  <div>
                    <span className="settings-row-label">{STATUS_LABELS[status]}</span>
                    <div className="status-desc">{STATUS_DESCRIPTIONS[status]}</div>
                  </div>
                  <div className="smart-import-frame-input-group">
                    <input
                      type="text"
                      className="smart-import-frame-input"
                      value={frameInputs[status]}
                      placeholder="1-5"
                      onChange={(e) => setFrameInputs((prev) => ({ ...prev, [status]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handlePreview(status); }}
                    />
                    <button
                      className="smart-import-preview-btn"
                      onClick={() => handlePreview(status)}
                    >
                      Preview
                    </button>
                  </div>
                </div>
                {previewFrames[status].length > 0 && (
                  <div className="smart-import-frame-previews">
                    {previewFrames[status].map((src, i) => (
                      <img key={i} src={src} alt={`Frame ${i}`} className="smart-import-frame-thumb" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!allStatusesAssigned && (
            <div className="smart-import-warning">
              Assign at least one frame to each status
            </div>
          )}

          <div className="custom-creator-actions">
            <button className="creator-btn cancel" onClick={onCancel}>Cancel</button>
            <button
              className="creator-btn save"
              onClick={handleSave}
              disabled={!name.trim() || !allStatusesAssigned || processing}
            >
              {processing ? "Processing..." : "Save"}
            </button>
          </div>
        </>
      )}

      {showModal && (
        <div className="smart-import-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="smart-import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="smart-import-modal-header">
              <span>All Frames ({frames.length})</span>
              <button className="smart-import-modal-close" onClick={() => setShowModal(false)}>x</button>
            </div>
            <div className="smart-import-modal-grid">
              {allFramePreviews.map((src, i) => (
                <div key={i} className="smart-import-modal-frame">
                  <img src={src} alt={`Frame ${i + 1}`} />
                  <span className="smart-import-modal-label">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
