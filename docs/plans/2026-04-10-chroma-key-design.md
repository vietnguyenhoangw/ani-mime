# Chroma Key Sprite Sheet Background Removal

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the white-only background removal in `spriteSheetProcessor.ts` with auto-detected chroma key removal that handles any solid-color background (green, magenta, blue, white, etc.), with a manual override in the SmartImport UI.

**Architecture:** Auto-detect the dominant corner color, remove all pixels within RGB distance 30 of that color. SmartImport shows detected color with a dropdown to override. Re-processes on color change.

**Tech Stack:** Canvas API, React state, no new dependencies

---

## Task 1: Add `detectBgColor` and refactor `prepareCanvas`

**Files:**
- Modify: `src/utils/spriteSheetProcessor.ts`

**Step 1: Write `detectBgColor` function**

Add before `prepareCanvas`:

```typescript
const BG_TOLERANCE = 30;

export function detectBgColor(canvas: HTMLCanvasElement): { r: number; g: number; b: number } {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;

  // Sample 4 corners (inset by 1px to avoid edge artifacts)
  const corners = [
    ctx.getImageData(1, 1, 1, 1).data,
    ctx.getImageData(width - 2, 1, 1, 1).data,
    ctx.getImageData(1, height - 2, 1, 1).data,
    ctx.getImageData(width - 2, height - 2, 1, 1).data,
  ];

  // Majority vote: find the most common color
  const colors = corners.map(d => ({ r: d[0], g: d[1], b: d[2] }));
  let bestColor = colors[0];
  let bestCount = 0;

  for (const candidate of colors) {
    const count = colors.filter(c =>
      colorDistance(c, candidate) <= BG_TOLERANCE
    ).length;
    if (count > bestCount) {
      bestCount = count;
      bestColor = candidate;
    }
  }

  return bestColor;
}

function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
```

**Step 2: Refactor `prepareCanvas`**

Change signature to accept optional bgColor and return both canvas and detected color. Replace white-only removal with tolerance-based removal:

```typescript
export function prepareCanvas(
  img: HTMLImageElement,
  bgColor?: { r: number; g: number; b: number }
): { canvas: HTMLCanvasElement; bgColor: { r: number; g: number; b: number } } {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  // Detect or use provided background color
  const detectedColor = bgColor ?? detectBgColor(canvas);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const dist = colorDistance(
      { r: data[i], g: data[i + 1], b: data[i + 2] },
      detectedColor
    );
    if (dist <= BG_TOLERANCE) {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return { canvas, bgColor: detectedColor };
}
```

**Step 3: Export new types/functions**

Export `detectBgColor` and the `BG_TOLERANCE` constant. Make sure `colorDistance` is not exported (internal helper).

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No new errors (return type changed, callers will need updating in Task 2)

**Step 5: Commit**

```bash
git add src/utils/spriteSheetProcessor.ts
git commit -m "feat: replace white-only removal with auto-detect chroma key in sprite processor"
```

---

## Task 2: Update SmartImport to handle new `prepareCanvas` signature and add color override UI

**Files:**
- Modify: `src/components/SmartImport.tsx`
- Modify: `src/styles/settings.css` (for swatch/dropdown styles)

**Step 1: Add bgColor state and update handlePickSheet**

```typescript
const [bgColor, setBgColor] = useState<{ r: number; g: number; b: number } | null>(null);
const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
```

In `handlePickSheet`, update to use new return shape:

```typescript
const img = await loadImage(src);
setImgElement(img);
const { canvas: prepared, bgColor: detected } = prepareCanvas(img);
setBgColor(detected);
setCanvas(prepared);
// ... rest stays the same (detectRows, previews, auto-assign)
```

**Step 2: Add reprocess function for color override**

```typescript
const reprocessWithColor = useCallback((newColor: { r: number; g: number; b: number }) => {
  if (!imgElement) return;
  setBgColor(newColor);
  const { canvas: prepared } = prepareCanvas(imgElement, newColor);
  setCanvas(prepared);

  const detected = detectRows(prepared);
  setRows(detected);
  const previews = detected.map((row) => getRowPreview(prepared, row));
  setRowPreviews(previews);

  // Reset assignments
  const autoAssign: Record<string, number[]> = {};
  for (const s of ALL_STATUSES) autoAssign[s] = [];
  const statusOrder: Status[] = ["idle", "busy", "service", "disconnected", "searching", "initializing", "visiting"];
  for (let i = 0; i < Math.min(detected.length, statusOrder.length); i++) {
    autoAssign[statusOrder[i]] = [i];
  }
  setAssignments(autoAssign as Record<Status, number[]>);
}, [imgElement]);
```

**Step 3: Add Background color row to the info card**

After the "Detected: X rows" row, add:

```tsx
<div className="settings-row">
  <span className="settings-row-label">Background</span>
  <div className="smart-import-bg-picker">
    <div
      className="smart-import-bg-swatch"
      style={{ backgroundColor: bgColor ? `rgb(${bgColor.r},${bgColor.g},${bgColor.b})` : "transparent" }}
    />
    <span className="smart-import-bg-hex">
      {bgColor ? `#${bgColor.r.toString(16).padStart(2,"0")}${bgColor.g.toString(16).padStart(2,"0")}${bgColor.b.toString(16).padStart(2,"0")}`.toUpperCase() : ""}
    </span>
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
```

**Step 4: Add CSS styles**

In `src/styles/settings.css`, add:

```css
.smart-import-bg-picker {
  display: flex;
  align-items: center;
  gap: 6px;
}

.smart-import-bg-swatch {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.smart-import-bg-hex {
  font-family: monospace;
  font-size: 11px;
  opacity: 0.7;
}
```

**Step 5: Run type check and test**

Run: `npx tsc --noEmit`
Run: `npx vitest run --reporter=verbose`
Expected: All pass

**Step 6: Commit**

```bash
git add src/components/SmartImport.tsx src/styles/settings.css
git commit -m "feat: add chroma key background picker to SmartImport UI"
```

---

## Task 3: Test with the Itachi sprite sheet

**Manual verification:**
1. Run `bun run tauri dev`
2. Open Settings > Mime tab
3. Click Smart Import
4. Select the Itachi sprite sheet (`~/Downloads/itachi.png`)
5. Verify: green background is auto-detected and removed
6. Verify: rows are properly detected (should see ~10+ rows with individual frames)
7. Verify: row previews show sprites on transparent background
8. Try changing background color via dropdown to verify reprocess works
9. Assign rows to statuses and save

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | `spriteSheetProcessor.ts` | Auto-detect bg color, tolerance-based removal |
| 2 | `SmartImport.tsx`, `settings.css` | bgColor state, swatch display, override dropdown |
| 3 | Manual | Test with Itachi sprite sheet |

**Total: 2 code tasks + 1 manual verification**
