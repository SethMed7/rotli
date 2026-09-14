// CodeMirror's stock keymaps bind ⌘I (selectParentSyntax), ⌘U (undoSelection)
// and ⌘[ / ⌘] (indent) with preventDefault — and the key registry ignores a
// keydown the editor already consumed (0.95.0), so editor.italic,
// editor.underline, nav.back and nav.forward never fired in a note. The vendor
// bindings now ask the registry first; chords the registry does not claim right
// now (⌘⌫ outside a System selection, the capture window's ⌘⏎) keep CM's command.

import { describe, expect, test } from "bun:test";

import type { EditorView, KeyBinding } from "@codemirror/view";

import { registerDefaultActions } from "../keys/actions";
import { EDITOR_ACTION } from "../keys/editorActionIds";
import { claimingAction } from "../keys/registry";

// CodeMirror performs one browser feature check at module load; the app has a
// real document, this test supplies only that seam (as resultWidget.test does).
(document as unknown as { documentElement: { style: Record<string, never> } }).documentElement = {
  style: {},
};
const { VENDOR_KEYMAP, registryChordOf, yieldToRegistry } = await import("./vendorKeymap");

const view = {} as EditorView;
const bindingFor = (bindings: readonly KeyBinding[], spec: string): KeyBinding | undefined =>
  bindings.find((b) => (b.mac ?? b.key) === spec);

describe("registryChordOf", () => {
  test("translates CodeMirror specs into registry chords (mac: Mod = ⌘)", () => {
    expect(registryChordOf("Mod-j")).toBe("Meta+J");
    expect(registryChordOf("Mod-\\")).toBe("Meta+Backslash");
    expect(registryChordOf("Mod-Alt-ArrowUp")).toBe("Alt+Meta+ArrowUp");
    expect(registryChordOf("Shift-Mod-k")).toBe("Shift+Meta+K");
    expect(registryChordOf("Cmd-ArrowLeft", true)).toBe("Shift+Meta+ArrowLeft");
  });

  test("bare keys stay CodeMirror-first", () => {
    expect(registryChordOf("Escape")).toBeNull();
    expect(registryChordOf("Shift-Tab")).toBeNull();
  });
});

describe("yieldToRegistry", () => {
  test("the stock keymap binds every chord that collided with the registry", () => {
    for (const spec of ["Mod-i", "Mod-u", "Mod-[", "Mod-]"]) {
      expect(bindingFor(VENDOR_KEYMAP, spec)).toBeDefined();
    }
  });

  test("a claimed chord runs the registry side and never the CodeMirror command", () => {
    const claimed: (string | null)[] = [];
    const yielded = yieldToRegistry(VENDOR_KEYMAP, (chord) => {
      claimed.push(chord);
      return true;
    });
    // the fake view has no state: reaching a CM command would throw
    for (const spec of ["Mod-i", "Mod-u", "Mod-[", "Mod-]"]) {
      expect(bindingFor(yielded, spec)?.run?.(view)).toBe(true);
    }
    expect(claimed).toEqual(["Mod-i", "Mod-u", "Mod-[", "Mod-]"].map((spec) => registryChordOf(spec)));
  });

  test("an unclaimed chord runs the CodeMirror command, plain and shifted", () => {
    const ran: string[] = [];
    const stub: KeyBinding[] = [
      { key: "Mod-z", run: () => ran.push("plain") > 0, shift: () => ran.push("shifted") > 0 },
      { key: "Escape", run: () => ran.push("bare") > 0 },
    ];
    const asked: string[] = [];
    const yielded = yieldToRegistry(stub, (chord) => asked.push(chord) < 0);
    yielded[0]?.run?.(view);
    yielded[0]?.shift?.(view);
    yielded[1]?.run?.(view);
    expect(ran).toEqual(["plain", "shifted", "bare"]);
    expect(asked).toEqual(["Meta+Z", "Shift+Meta+Z"]);
  });
});

describe("the registry's claim at press time", () => {
  registerDefaultActions();

  const claimOf = (spec: string) => claimingAction(registryChordOf(spec) ?? "");

  test("claims the formatting and navigation chords CodeMirror also binds", () => {
    expect(claimOf("Mod-i")?.id).toBe(EDITOR_ACTION.italic);
    expect(claimOf("Mod-u")?.id).toBe(EDITOR_ACTION.underline);
    expect(claimOf("Mod-[")?.id).toMatch(/^nav\./);
    expect(claimOf("Mod-]")?.id).toMatch(/^nav\./);
    expect(claimOf("Mod-[")?.id).not.toBe(claimOf("Mod-]")?.id);
  });

  test("leaves delete-to-line-start, insert-blank-line and undo to the editor in a note", () => {
    // the trash chord acts only on a System selection; the blank-line chord is setup/capture only
    for (const spec of ["Mod-Backspace", "Mod-Enter", "Mod-z"]) expect(claimOf(spec)).toBeNull();
  });
});
