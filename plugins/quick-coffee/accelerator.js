// Pure helper: turn a keydown event into a Tauri global-shortcut accelerator
// string (e.g. "CmdOrCtrl+Shift+G"), or null if the combo is incomplete.
// Exported as an ESM module so it can be unit-tested; index.html imports it.

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

// Named keys that Tauri spells differently from the DOM `key` value.
const KEY_ALIASES = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  Escape: "Esc",
};

export function eventToAccelerator(e) {
  if (MODIFIER_KEYS.has(e.key)) return null; // only a modifier held

  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null; // require at least one modifier

  let key = KEY_ALIASES[e.key] || e.key;
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}
