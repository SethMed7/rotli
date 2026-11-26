// When the main window may take the `rotli open` mailbox. Never while a setup
// screen shows: the request would open into panes that setup's vault switch
// clears. It stays on disk, where a quit keeps it, except across a switch: the
// mailbox sits under the vault's own folder, so it is taken into memory first
// and opens once setup ends (docs/architecture/agent-workspace.md).

import { isTauri, type WorkspaceOpenRequest, workspaceTakeOpenRequest } from "../lib/tauri";

type Deliver = (request: WorkspaceOpenRequest) => void | Promise<void>;
type Take = () => Promise<WorkspaceOpenRequest | null>;

export function createOpenRequestGate(take: Take) {
  let deliver: Deliver | null = null;
  // null until the window says: nothing is taken before then
  let setupShown: boolean | null = null;
  let switching = 0;
  let held: WorkspaceOpenRequest | null = null;
  let queue = Promise.resolve();

  const isOpen = () => setupShown === false && switching === 0 && deliver !== null;

  /** Reads and deliveries run one at a time, in order. */
  const inTurn = (step: () => Promise<void>) => (queue = queue.then(step).catch(() => {}));

  /** The mailbox holds one request and the newest wins, held ones included. */
  const read = async () => {
    held = (await take().catch(() => null)) ?? held;
  };

  const consume = () =>
    inTurn(async () => {
      if (!isOpen()) return;
      await read();
      // setup may have appeared, or the window gone, while the read ran
      if (!isOpen() || !held) return;
      const request = held;
      held = null;
      await deliver?.(request);
    });

  return {
    attach(next: Deliver): () => void {
      deliver = next;
      void consume();
      return () => {
        if (deliver === next) deliver = null;
      };
    },
    consume,
    setSetupShown(shown: boolean): Promise<void> {
      setupShown = shown;
      return consume();
    },
    /** A setup screen is about to switch vaults: take what is queued in this
     * one, and deliver nothing until the returned release. Outside setup a
     * switch leaves the mailbox alone. */
    async holdForSwitch(): Promise<() => void> {
      if (!setupShown) return () => {};
      switching++;
      await inTurn(read);
      return () => {
        switching--;
        void consume();
      };
    },
  };
}

export const openRequestGate = createOpenRequestGate(() =>
  isTauri() ? workspaceTakeOpenRequest() : Promise.resolve(null),
);
