# Sprite Display Scale

Add a global display scale setting so users can make their mascot bigger or smaller without changing sprite assets.

## Scale Presets

Four options, selectable in the mime selection settings window:

| Label  | Scale | Main Sprite | Visitor Sprite |
|--------|-------|-------------|----------------|
| Tiny   | 0.5×  | 64×64px     | 48×48px        |
| Normal | 1×    | 128×128px   | 96×96px        |
| Large  | 1.5×  | 192×192px   | 144×144px      |
| XL     | 2×    | 256×256px   | 192×192px      |

Visitor sprites maintain the current 0.75× ratio to the main sprite.

## What Scales

- Main sprite dimensions
- Visitor sprite dimensions
- Visitor offset spacing (`index * 80 * scale`)
- Visiting placeholder div
- Speech bubble negative margin (sprite overlap)

## What Doesn't Scale

- Status pill (text, dot, padding)
- Speech bubble (text, padding, border radius)
- Dev tag, scenario badge
- Glow effect radii (3px/8px stay fixed)

## Window Sizing

The window resizes dynamically per scale. Formula:

```
width  = padding_left + sprite_size + visitor_overflow + margin
height = bubble_height + gap + sprite_size + gap + pill_height + margin
```

| Scale | Window W × H   |
|-------|-----------------|
| 0.5×  | ~300 × 130px    |
| 1×    | ~500 × 220px    |
| 1.5×  | ~650 × 290px    |
| 2×    | ~800 × 360px    |

Rust backend calls `window.set_size()` on scale change. Window stays non-resizable by user.

## Persistence

`displayScale` key in Tauri store (`settings.json`). Values: `0.5`, `1`, `1.5`, `2`. Default: `1`. Applied before first render on launch.

## Settings UI

Segmented control in the mime selection window:

```
[ Tiny ] [ Normal ] [ Large ] [ XL ]
  0.5×      1×        1.5×     2×
```

Active scale is highlighted. Clicking saves to store and emits event.

## Data Flow

```
Settings UI (click scale)
  → save displayScale to store
  → emit Tauri event "scale-changed" { scale }

Frontend
  → useScale() hook listens for "scale-changed"
  → sets --sprite-scale CSS variable on :root
  → Mascot.tsx: calc(128px * var(--sprite-scale))
  → VisitorDog.tsx: calc(96px * var(--sprite-scale))

Backend
  → listens for "scale-changed"
  → computes new window size
  → calls window.set_size()
```

## Implementation Details

### New: `useScale()` hook
- Reads `displayScale` from store on mount
- Listens for `"scale-changed"` Tauri events
- Sets `--sprite-scale` on `document.documentElement.style`
- Exposes `scale` number value

### Mascot.tsx
- Sprite div: `width/height: 128 * scale`
- `background-size: ${frames * 128 * scale}px ${128 * scale}px`
- Frozen frame: `-(frames - 1) * 128 * scale`px

### mascot.css
- Replace hardcoded 128px with `calc(128px * var(--sprite-scale, 1))`

### VisitorDog.tsx
- Sprite size: `96 * scale`
- Offset: `index * 80 * scale`

### visitor.css
- `right: calc((-110px * var(--sprite-scale, 1)) - var(--visitor-offset))`
- `background-size` uses scaled height

### No changes needed
- Sprite sheet PNGs (CSS scaling handles it)
- Custom mime upload flow (still 128px-per-frame)
- Shell hooks, HTTP server, state machine
- Status resolution logic
