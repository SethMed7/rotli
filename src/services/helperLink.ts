// Rotli Web: pair with, check, and forget Rotli Helper. The link lives in the
// browser vault (this device only); once paired, the AI commands the Mac app
// sends to Rust ride the helper instead, through the same IPC seam.

import { IndexedDbVaultStore, MemoryVaultStore, type VaultStore } from "../lib/browserVault";
import { HelperHttpError, helperHealth, helperRpc } from "../lib/helperClient";
import { HELPER_COMMANDS, type HelperLink, parsePairingCode } from "../lib/helperPairing";
import { registerWebAiBridge } from "../lib/webAiSeam";
import { type HelperProblem, useHelperLink } from "../state/helperLink";

const LINK_KEY = "helper-link";

// The pairing is a DEVICE credential, never vault data: in folder or imported
// mode the browser vault maps keys to .rotli/ files that travel with an export,
// so the link lives in this browser's own database whatever the vault mode.
let deviceStore: VaultStore | null = null;
function device(): VaultStore {
  deviceStore ??= typeof indexedDB === "undefined" ? new MemoryVaultStore() : new IndexedDbVaultStore();
  return deviceStore;
}

function bridgeFor(link: HelperLink) {
  return (cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> => {
    if (!HELPER_COMMANDS.has(cmd)) {
      return Promise.reject(new Error(`${cmd}: not available through Rotli Helper`));
    }
    // text only in this release: an attached image would switch the CLI's
    // file-reading tools on, and a browser-delivered prompt must not reach those
    const images = args?.images;
    if (cmd === "cli_complete" && Array.isArray(images) && images.length > 0) {
      return Promise.reject(new Error("Images are not sent through Rotli Helper in this release."));
    }
    return helperRpc(link, cmd, args ?? {}).then(
      (result) => {
        // a call that lands clears whatever was wrong
        const state = useHelperLink.getState();
        if (state.problem !== null) state.setProblem(null);
        if (state.reachable !== true) state.setReachable(true);
        return result;
      },
      (error: unknown) => {
        noteFailure(error);
        throw error;
      },
    );
  };
}

/** Record what a failed call says about the pairing: a 401 is a refused
 * token, a network failure is an unreachable helper; a tool's own error is
 * neither and leaves the pairing alone. */
function noteFailure(error: unknown): void {
  const state = useHelperLink.getState();
  if (error instanceof HelperHttpError) {
    if (error.status === 401) state.setProblem("refused");
    return;
  }
  if (error instanceof TypeError) {
    state.setReachable(false);
    state.setProblem("unreachable");
  }
}

function adopt(link: HelperLink | null): void {
  useHelperLink.getState().setLink(link);
  registerWebAiBridge(link ? bridgeFor(link) : null);
}

/** Boot: restore the pairing and ask the helper whether it is there — and
 * whether it still takes our token, so a new install's new code is caught
 * before the chat opens. */
export async function hydrateHelperLink(): Promise<void> {
  let link: HelperLink | null = null;
  try {
    const raw = await device().get(LINK_KEY);
    link = raw ? parsePairingCode(raw) : null;
  } catch {
    link = null;
  }
  adopt(link);
  if (link) void verifyHelper();
}

/** Health, then one authenticated call: the whole pairing, re-checked. The
 * dialog's "Check again" runs this; so does boot. */
export async function verifyHelper(): Promise<"ok" | HelperProblem> {
  const link = useHelperLink.getState().link;
  if (!link) return "unreachable";
  if (!(await checkHelper())) {
    useHelperLink.getState().setProblem("unreachable");
    return "unreachable";
  }
  try {
    await helperRpc(link, "chat_models", {});
    useHelperLink.getState().setProblem(null);
    return "ok";
  } catch (error) {
    const refused = error instanceof HelperHttpError && error.status === 401;
    useHelperLink.getState().setProblem(refused ? "refused" : "unreachable");
    return refused ? "refused" : "unreachable";
  }
}

/** Ask the helper whether it answers; remembered for the surfaces. */
export async function checkHelper(): Promise<boolean> {
  const link = useHelperLink.getState().link;
  if (!link) return false;
  try {
    const health = await helperHealth(link.port);
    useHelperLink.getState().setReachable(health.ok === true);
    return health.ok === true;
  } catch {
    useHelperLink.getState().setReachable(false);
    return false;
  }
}

/** Pair from the code the helper printed. Refuses a code that does not
 * parse, and a port where nothing answers, before remembering anything. */
export async function pairHelper(code: string): Promise<void> {
  const link = parsePairingCode(code);
  if (!link) throw new Error("That is not a pairing code. It looks like 43111:… — copy the whole line.");
  let health;
  try {
    health = await helperHealth(link.port);
  } catch {
    throw new Error(
      `Nothing answered on port ${link.port}. Is Rotli Helper running? Its window shows the pairing code.`,
    );
  }
  if (!health.ok || health.name !== "rotli-helper") throw new Error(`Port ${link.port} is not Rotli Helper.`);
  // the token is proven by one authenticated call before it is kept
  await helperRpc(link, "chat_models", {});
  await device().set(LINK_KEY, `${link.port}:${link.token}`);
  adopt(link);
  useHelperLink.getState().setReachable(true);
}

/** Forget the pairing on this device. The helper keeps its token. */
export async function unpairHelper(): Promise<void> {
  try {
    await device().delete(LINK_KEY);
  } catch {
    /* forgetting can only fail to persist; the session forgets regardless */
  }
  adopt(null);
  useHelperLink.getState().setReachable(null);
}
