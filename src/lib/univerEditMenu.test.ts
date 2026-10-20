import { describe, expect, test } from "bun:test";

import {
  MENU_DEDUPE_MS,
  historyChordStep,
  historyInputStep,
  installUniverEditMenu,
  isMacPlatform,
  menuDedupe,
  type HistoryStep,
} from "./univerEditMenu";

const chord = (
  overrides: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>,
) => ({
  code: "KeyZ",
  metaKey: true,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

function fire(target: EventTarget, type: string, props: object, prevented = false): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), props);
  if (prevented) event.preventDefault();
  target.dispatchEvent(event);
  return event;
}

describe("Univer Edit-menu history steps", () => {
  test("the menu's beforeinput names undo or redo; other input is ignored", () => {
    expect(historyInputStep("historyUndo")).toBe("undo");
    expect(historyInputStep("historyRedo")).toBe("redo");
    expect(historyInputStep("insertText")).toBeNull();
  });

  test("⌘Z is undo, ⇧⌘Z is redo, and other chords are neither", () => {
    expect(historyChordStep(chord({}), true)).toBe("undo");
    expect(historyChordStep(chord({ shiftKey: true }), true)).toBe("redo");
    expect(historyChordStep(chord({ code: "KeyA" }), true)).toBeNull();
    expect(historyChordStep(chord({ metaKey: false, ctrlKey: true }), false)).toBe("undo");
  });

  test("a command Univer just ran is not run again by its menu echo", () => {
    let now = 1_000;
    const dedupe = menuDedupe(() => now);
    expect(dedupe.due("univer.command.undo")).toBe(true);
    dedupe.ran("univer.command.undo");
    now += MENU_DEDUPE_MS - 1;
    expect(dedupe.due("univer.command.undo")).toBe(false);
    expect(dedupe.due("univer.command.redo")).toBe(true);
    now += 1;
    expect(dedupe.due("univer.command.undo")).toBe(true);
  });
});

describe("installUniverEditMenu", () => {
  function setup(owns = true) {
    const view = new EventTarget();
    const keyTarget = new EventTarget();
    const menu: HistoryStep[] = [];
    const keys: HistoryStep[] = [];
    const release = installUniverEditMenu({
      view: view as unknown as Document,
      keyTarget,
      owns: () => owns,
      fromMenu: (step) => menu.push(step),
      fromKey: (step) => keys.push(step),
    });
    return { view, keyTarget, menu, keys, release };
  }

  test("routes the menu's undo and redo to Univer and keeps WebKit's off the hidden input", () => {
    const { view, menu } = setup();
    expect(fire(view, "beforeinput", { inputType: "historyUndo" }).defaultPrevented).toBe(true);
    fire(view, "beforeinput", { inputType: "historyRedo" });
    expect(fire(view, "beforeinput", { inputType: "insertText" }).defaultPrevented).toBe(false);
    expect(menu).toEqual(["undo", "redo"]);
  });

  test("answers only the chords Univer left unhandled", () => {
    const { keyTarget, keys } = setup();
    const isMac = isMacPlatform();
    const press = (shiftKey: boolean, prevented = false) =>
      fire(keyTarget, "keydown", chord({ metaKey: isMac, ctrlKey: !isMac, shiftKey }), prevented);
    expect(press(false).defaultPrevented).toBe(true);
    press(true);
    press(false, true);
    expect(keys).toEqual(["undo", "redo"]);
  });

  test("stands down when the editor does not own focus, and after release", () => {
    const unowned = setup(false);
    expect(fire(unowned.view, "beforeinput", { inputType: "historyUndo" }).defaultPrevented).toBe(false);
    expect(unowned.menu).toEqual([]);

    const owned = setup();
    owned.release();
    fire(owned.view, "beforeinput", { inputType: "historyUndo" });
    expect(owned.menu).toEqual([]);
  });
});
