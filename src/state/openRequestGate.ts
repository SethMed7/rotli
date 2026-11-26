// When the main window may take the `rotli open` mailbox. Never while a setup
// screen shows: the request would open into panes that setup's vault switch
// clears. It stays on disk, where a quit keeps it, except across a switch: the
// mailbox sits under the vault's own folder, so it is taken into memory and
// opens once setup ends, or goes back on disk if the vault didn't move
// (docs/architecture/agent-workspace.md).

import {
  type WorkspaceOpenRequest,
  workspaceReturnOpenRequest,
  workspaceTakeOpenRequest,
} from "../lib/tauri";

type Deliver = (request: WorkspaceOpenRequest) => void | Promise<void>;
type Take = () => Promise<WorkspaceOpenRequest | null>;
type GiveBack = (request: WorkspaceOpenRequest) => Promise<void>;

export function createOpenRequestGate(take: Take, giveBack: GiveBack) {
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
      // a switch moves the mailbox: what arrives meanwhile is read now, while
      // Rust may still be reading this vault's
      if (switching > 0) return read();
      if (!isOpen()) return;
      await read();
      // setup may have appeared, or the window gone, while the read ran
      if (!isOpen() || !held) return;
      const request = held;
      held = null;
      await deliver?.(request);
    });

  /** The vault didn't move, so on disk a quit keeps the request. Outside setup
   * the next turn opens it instead; a failed write leaves it held. */
  const putBack = async () => {
    if (!setupShown || switching > 0 || !held) return;
    await giveBack(held);
    held = null;
  };

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
     * one, and deliver nothing until the returned release, which says whether
     * the vault moved. Outside setup a switch leaves the mailbox alone. */
    async holdForSwitch(): Promise<(moved: boolean) => void> {
      if (!setupShown) return () => {};
      switching++;
      await inTurn(read);
      return (moved) => {
        switching--;
        if (!moved) void inTurn(putBack);
        void consume();
      };
    },
  };
}

export const openRequestGate = createOpenRequestGate(workspaceTakeOpenRequest, workspaceReturnOpenRequest);
