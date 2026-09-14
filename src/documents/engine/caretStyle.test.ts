import { describe, expect, test } from "bun:test";

import { keepCaretStyleThroughNoopMutations } from "./caretStyle";

type Listener = (command: { id: string; type?: number; params?: unknown }) => void;

/** A command bus that runs listeners in registration order, like Univer's. */
function fakeUniver() {
  const before: Listener[] = [];
  const after: Listener[] = [];
  let refreshes = 0;
  const selection = {
    refreshSelection() {
      refreshes += 1;
    },
  };
  const hooks = {
    beforeCommandExecuted(listener: Listener) {
      before.push(listener);
      return { dispose: () => before.splice(before.indexOf(listener), 1) };
    },
    onCommandExecuted(listener: Listener) {
      after.push(listener);
      return { dispose: () => after.splice(after.indexOf(listener), 1) };
    },
  };
  // Univer's render controller subscribes before Rotli's adapter does.
  hooks.onCommandExecuted((command) => {
    if (command.id === "doc.mutation.rich-text-editing") selection.refreshSelection();
  });
  const execute = (command: { id: string; type?: number; params?: unknown }) => {
    before.forEach((listener) => listener(command));
    after.forEach((listener) => listener(command));
  };
  return { hooks, selection, execute, refreshes: () => refreshes };
}

const caretOnly = { id: "doc.mutation.rich-text-editing", type: 2, params: { actions: null } };
const typed = { id: "doc.mutation.rich-text-editing", type: 2, params: { actions: ["body", {}] } };

describe("pending caret style", () => {
  test("a format armed at a collapsed caret does not refresh (and clear) the selection", () => {
    const univer = fakeUniver();
    keepCaretStyleThroughNoopMutations(univer.hooks, univer.selection);

    univer.execute(caretOnly);
    expect(univer.refreshes()).toBe(0);

    univer.execute(typed);
    expect(univer.refreshes()).toBe(1);
  });

  test("without the guard Univer refreshes on the no-op mutation", () => {
    const univer = fakeUniver();
    univer.execute(caretOnly);
    expect(univer.refreshes()).toBe(1);
  });

  test("dispose restores the vendor refresh", () => {
    const univer = fakeUniver();
    const guard = keepCaretStyleThroughNoopMutations(univer.hooks, univer.selection);
    guard.dispose();
    univer.execute(caretOnly);
    expect(univer.refreshes()).toBe(1);
  });
});
