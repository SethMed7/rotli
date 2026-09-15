// Keeps a format armed at a collapsed caret alive until the next keystroke.
//
// Univer 0.25 stores a caret's pending style (toolbar Bold, text color,
// highlight chosen with no selection) in a style cache that is cleared on
// every selection emission. Arming it still dispatches a rich-text mutation
// with no actions, and Univer's own render controller answers every rich-text
// mutation by refreshing the selection, which re-emits it and clears the
// cache in the same tick. A no-op mutation changes neither layout nor
// selection, so the refresh it triggers is skipped here.

import { isDocumentContentMutation } from "./policy";

const RICH_TEXT_MUTATION = "doc.mutation.rich-text-editing";

interface CommandEvent {
  id: string;
  type?: number;
  params?: unknown;
}

interface CommandHooks {
  beforeCommandExecuted(listener: (command: CommandEvent) => void): { dispose(): void };
  onCommandExecuted(listener: (command: CommandEvent) => void): { dispose(): void };
}

interface SelectionRefresher {
  refreshSelection(...args: never[]): void;
}

export function isCaretOnlyMutation(command: CommandEvent): boolean {
  return command.id === RICH_TEXT_MUTATION && !isDocumentContentMutation(command);
}

export function keepCaretStyleThroughNoopMutations(
  commands: CommandHooks,
  selection: SelectionRefresher,
): { dispose(): void } {
  let caretOnlyDepth = 0;
  const refresh = selection.refreshSelection.bind(selection);
  selection.refreshSelection = (...args: never[]) => {
    if (caretOnlyDepth === 0) refresh(...args);
  };
  const before = commands.beforeCommandExecuted((command) => {
    if (!isCaretOnlyMutation(command)) return;
    caretOnlyDepth += 1;
    // the refresh runs synchronously inside the mutation; never let a vendor
    // error that skips the after-listener suppress refreshes past this tick
    queueMicrotask(() => {
      caretOnlyDepth = 0;
    });
  });
  const after = commands.onCommandExecuted((command) => {
    if (isCaretOnlyMutation(command)) caretOnlyDepth = Math.max(0, caretOnlyDepth - 1);
  });
  return {
    dispose: () => {
      before.dispose();
      after.dispose();
      selection.refreshSelection = refresh;
    },
  };
}
