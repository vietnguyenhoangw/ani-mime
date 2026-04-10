import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Status } from "../types/status";
import {
  loadImage,
  prepareCanvas,
  detectRows,
  createStrip,
  getRowPreview,
  type DetectedRow,
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

export function SmartImport({ onSave, onCancel }: SmartImportProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [rows, setRows] = useState<DetectedRow[]>([]);
  const [rowPreviews, setRowPreviews] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<Status, number[]>>(() => {
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = [];
    return init;
  });
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [bgColor, setBgColor] = useState<BgColor | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);

  const handlePickSheet = useCallback(async () => {
    const result = await open({
      multiple: false,
      filters: [{ name: "Sprite Sheet", extensions: ["png", "gif", "jpg", "jpeg"] }],
    });
    if (!result) return;

    setFileName(result.split("/").pop() ?? "");
    const src = convertFileSrc(result);
    const img = await loadImage(src);
    setImgElement(img);
    const { canvas: prepared, bgColor: detectedBg } = prepareCanvas(img);
    setBgColor(detectedBg);
    setCanvas(prepared);

    const detected = detectRows(prepared);
    setRows(detected);

    // Generate previews for each row
    const previews = detected.map((row) => getRowPreview(prepared, row));
    setRowPreviews(previews);

    // Auto-assign rows to statuses in order
    const autoAssign: Record<string, number[]> = {};
    for (const s of ALL_STATUSES) autoAssign[s] = [];

    // Map first N rows to statuses, remaining rows unassigned
    const statusOrder: Status[] = ["idle", "busy", "service", "disconnected", "searching", "initializing", "visiting"];
    for (let i = 0; i < Math.min(detected.length, statusOrder.length); i++) {
      autoAssign[statusOrder[i]] = [i];
    }

    setAssignments(autoAssign as Record<Status, number[]>);
  }, []);

  const reprocessWithColor = useCallback((newColor: BgColor) => {
    if (!imgElement) return;
    setBgColor(newColor);
    const { canvas: prepared } = prepareCanvas(imgElement, newColor);
    setCanvas(prepared);

    const detected = detectRows(prepared);
    setRows(detected);
    const previews = detected.map((row) => getRowPreview(prepared, row));
    setRowPreviews(previews);

    const autoAssign: Record<string, number[]> = {};
    for (const s of ALL_STATUSES) autoAssign[s] = [];
    const statusOrder: Status[] = ["idle", "busy", "service", "disconnected", "searching", "initializing", "visiting"];
    for (let i = 0; i < Math.min(detected.length, statusOrder.length); i++) {
      autoAssign[statusOrder[i]] = [i];
    }
    setAssignments(autoAssign as Record<Status, number[]>);
  }, [imgElement]);

  const getStatusForRow = useCallback((rowIndex: number): Status | null => {
    for (const s of ALL_STATUSES) {
      if (assignments[s].includes(rowIndex)) return s;
    }
    return null;
  }, [assignments]);

  const allStatusesAssigned = ALL_STATUSES.every((s) => assignments[s].length > 0);

  const handleSave = useCallback(async () => {
    if (!canvas || !name.trim() || !allStatusesAssigned) return;
    setProcessing(true);

    try {
      const blobs: Record<string, { blob: Uint8Array; frames: number }> = {};

      for (const status of ALL_STATUSES) {
        const assignedRows = assignments[status].map((i) => rows[i]);
        const strip = await createStrip(canvas, assignedRows);
        blobs[status] = strip;
      }

      await onSave(name.trim(), blobs as Record<Status, { blob: Uint8Array; frames: number }>);
    } finally {
      setProcessing(false);
    }
  }, [canvas, name, allStatusesAssigned, assignments, rows, onSave]);

  return (
    <div className="smart-import">
      {!canvas ? (
        <div className="smart-import-pick">
          <div className="settings-card">
            <div className="smart-import-dropzone" onClick={handlePickSheet}>
              <div className="add-icon" style={{ fontSize: 32 }}>+</div>
              <span>Choose a sprite sheet</span>
              <span className="smart-import-hint">PNG, GIF, or JPG</span>
            </div>
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
              <span className="settings-row-label">Detected</span>
              <span className="smart-import-file">{rows.length} rows</span>
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
              <span className="settings-row-label">Assign rows to states</span>
            </div>
            {rows.map((row, i) => {
              const assignedStatus = getStatusForRow(i);
              return (
                <div className="smart-import-row" key={i}>
                  <div className="smart-import-row-preview">
                    <img src={rowPreviews[i]} alt={`Row ${i}`} />
                  </div>
                  <div className="smart-import-row-info">
                    <span className="smart-import-row-label">Row {i + 1}</span>
                    <span className="smart-import-row-frames">{row.frameCount} frames</span>
                  </div>
                  <select
                    className="smart-import-select"
                    value={assignedStatus ?? ""}
                    onChange={(e) => {
                      const newStatus = e.target.value as Status | "";
                      // Remove this row from any current assignment
                      setAssignments((prev) => {
                        const next = { ...prev };
                        for (const s of ALL_STATUSES) {
                          next[s] = next[s].filter((idx) => idx !== i);
                        }
                        if (newStatus) {
                          next[newStatus] = [...next[newStatus], i].sort((a, b) => a - b);
                        }
                        return next;
                      });
                    }}
                  >
                    <option value="">-- skip --</option>
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {!allStatusesAssigned && (
            <div className="smart-import-warning">
              Assign at least one row to each status
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
    </div>
  );
}
