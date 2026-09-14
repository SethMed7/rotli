// A document pane registers an editor handle, so the shared editor.* format
// actions reach Univer instead of resolving to nothing after the dispatcher
// has claimed the chord.

import { afterEach, describe, expect, test } from "bun:test";

import { documentFormatHandle } from "../documents/engine/format";
import { registerEditor, unregisterEditor } from "../editor/commands";
import { usePanesStore } from "../state/panes";
import { registerDefaultActions } from "./actions";
import { dispatch } from "./registry";

registerDefaultActions();

describe("document pane format actions", () => {
  const ran: string[] = [];
  const handle = documentFormatHandle((id) => ran.push(id));
  const paneId = usePanesStore.getState().focusedPaneId;

  afterEach(() => {
    unregisterEditor(paneId, handle);
    ran.length = 0;
  });

  test("editor.bold reaches the focused document pane's handle", () => {
    registerEditor(paneId, handle);

    dispatch("editor.bold");
    dispatch("editor.heading1");

    expect(ran).toEqual(["doc.command.set-inline-format-bold", "doc.command.h1-heading"]);
  });

  test("an unregistered document pane receives nothing", () => {
    registerEditor(paneId, handle);
    unregisterEditor(paneId, handle);

    dispatch("editor.bold");

    expect(ran).toEqual([]);
  });
});
