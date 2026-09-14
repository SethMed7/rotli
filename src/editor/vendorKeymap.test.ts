// CodeMirror's stock keymaps bind ⌘I (selectParentSyntax), ⌘U (undoSelection),
// ⌘[ / ⌘] (indent) and ⌘⏎ (insertBlankLine) with preventDefault — and the key
// registry ignores a keydown the editor already consumed (0.95.0). Those chords
// belong to editor.italic / editor.underline / nav.back / nav.forward /
// setup.continue, so the vendor set must lose them before it is installed.

import { describe, expect, test } from "bun:test";

import { registerDefaultActions } from "../keys/actions";

// CodeMirror performs one browser feature check at module load; the app has a
// real document, this test supplies only that seam (as resultWidget.test does).
(document as unknown as { documentElement: { style: Record<string, never> } }).documentElement = {
  style: {},
};
const { VENDOR_KEYMAP, bindsKey, filterVendorKeymap, registryOwnedChords } = await import("./vendorKeymap");

const OWNED = ["Meta+I", "Meta+U", "Meta+BracketLeft", "Meta+BracketRight", "Meta+Enter"];
const COLLIDING = ["Mod-i", "Mod-u", "Mod-[", "Mod-]", "Mod-Enter"];

describe("filterVendorKeymap", () => {
  test("the raw vendor keymap does bind every colliding chord", () => {
    for (const key of COLLIDING) expect(bindsKey(VENDOR_KEYMAP, key)).toBe(true);
  });

  test("the filtered keymap binds none of the registry-owned chords", () => {
    const filtered = filterVendorKeymap(VENDOR_KEYMAP, OWNED);
    for (const key of COLLIDING) expect(bindsKey(filtered, key)).toBe(false);
  });

  test("undo, select-all and the shifted redo survive the filter", () => {
    const filtered = filterVendorKeymap(VENDOR_KEYMAP, OWNED);
    expect(bindsKey(filtered, "Mod-z")).toBe(true);
    expect(bindsKey(filtered, "Mod-a")).toBe(true);
    // ⌘⇧U is CM's redoSelection — a different chord from ⌘U, so it stays
    expect(bindsKey(filtered, "Mod-Shift-u")).toBe(true);
  });

  test("a chord written in either modifier order matches the same binding", () => {
    const filtered = filterVendorKeymap(VENDOR_KEYMAP, ["Meta+Shift+K"]);
    expect(bindsKey(VENDOR_KEYMAP, "Shift-Mod-k")).toBe(true);
    expect(bindsKey(filtered, "Shift-Mod-k")).toBe(false);
  });

  test("the registry's default chords claim all five colliding keys", () => {
    registerDefaultActions();
    const owned = registryOwnedChords();
    for (const chord of OWNED) expect(owned).toContain(chord);
  });

  test("an unbound registry action (null chord) filters nothing", () => {
    expect(filterVendorKeymap(VENDOR_KEYMAP, [null])).toHaveLength(VENDOR_KEYMAP.length);
  });
});
