# Edit Existing Custom Sprite

## Goal

Allow users to edit any field on an existing custom sprite (name, sprite files, frame counts) without deleting and recreating it.

## Interaction Flow

1. User hovers over a custom sprite card in Settings > Mime tab
2. A pencil/edit button appears alongside the existing delete (x) button
3. Clicking it opens the **same creation form**, pre-filled with existing values:
   - Name field shows current name
   - Each status row shows the existing filename and frame count
   - File picker buttons display the current filename instead of "Choose PNG"
   - Frame count inputs show current values
4. User modifies any fields they want
5. On Save:
   - Only changed sprite files are copied to disk (unchanged statuses keep existing files)
   - `CustomMimeData` metadata is updated in the store **with the same ID**
   - `custom-mimes-changed` event is emitted
   - View returns to browse mode
6. Cancel returns to browse mode with no changes

## Data & State Changes

### `useCustomMimes` hook

New function: `updateMime(id, name, sprites)`

1. Finds existing mime by ID in the store
2. For each status, compares new file path to old:
   - **Changed**: copies new file to `custom-sprites/{id}-{status}.png`, overwriting old
   - **Unchanged**: skips file copy
3. Updates the `CustomMimeData` entry in the array (same ID, new name/sprites)
4. Calls `store.set()` + `store.save()`
5. Emits `custom-mimes-changed`

### Form state per status row

- `filePath: string | null` — new file picked by user (`null` = keep existing)
- `existingFileName: string` — current filename for display
- `frames: number` — editable frame count

On save, if `filePath` is null for a status, skip file copy and only update frame count in metadata.

### No new types

`CustomMimeData` already has the right shape. No changes to `status.ts`.

## Settings.tsx UI Changes

### State

- **`editingMime: string | null`** — ID of mime being edited, or `null` for browse mode
- **`creatingCustom: boolean`** — stays as-is for new creation

### Form behavior

When `editingMime` is set:
- Same form renders, initialized from existing `CustomMimeData`
- Save calls `updateMime()` instead of `addMime()`
- Cancel clears `editingMime` to `null`

### Edit button on card

Pencil icon button in hover overlay, next to delete button. Clicking sets `editingMime` to that card's ID.

### Validation

Same as creation — all 7 statuses must have a file (existing or newly picked) and a frame count.

## Scope

- One new hook function (`updateMime`)
- Form pre-filling logic in Settings.tsx
- Edit button on sprite card
- No new components, types, or storage format changes
