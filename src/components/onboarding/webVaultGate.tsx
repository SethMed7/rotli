// Rotli Web's setup: before anything else, connect the vault — a real folder
// on this computer — and keep it connected. Nothing is usable without one
// (2026-09-22, the owner): notes are files in that folder, never a copy in
// the browser. Two roads, chosen by what the browser can do:
// - Chrome, Edge, Arc: the browser's own folder picker, live read and write.
// - Zen, Firefox, Brave with its flag off: Rotli Helper, a small program on
//   this computer that serves the one folder the user picks with the OS's
//   own picker. It starts at login and pairs itself with this page.
// The same screen is the reconnect screen when a bound vault can't be
// reached (permission, a helper that isn't running, a new pairing code): it
// always names the vault and never offers somewhere else to write.
//
// Privacy: this page talks to nothing but Rotli Helper on 127.0.0.1, and the
// helper touches only the folder chosen here.

import { useEffect, useState } from "react";

import { guideOs } from "../../ai/connectorGuides";
import { setSetupHandle } from "../../keys/handles";
import { adoptStoredPairing } from "../../services/helperLink";
import {
  type HelperProbe,
  type HelperVaultInfo,
  chooseHelperVault,
  helperConnection,
  loadHelperBinding,
  probeHelper,
  saveHelperBinding,
} from "../../services/vaultBinding";
import {
  type FolderSupport,
  browserFolderSupportSync,
  connectFolderVault,
  reconnectFolderVault,
} from "../../services/webVaultFolder";
import { useHelperLink } from "../../state/helperLink";
import { type VaultConnection, useVaultConnection } from "../../state/vaultConnection";
import { Character } from "../character";
import { CopyCommand, GuideStep } from "../settings/connectorGuide";
import { PairingCodeForm, helperInstall } from "../webChatSetupDialog";
import { pickerFailure } from "../webVaultConnectDialog";
import { type SetupOption, SetupChoiceGroup, SetupPrimary } from "./setupControls";

/** Where setup stands. Pure over what boot and the helper said. */
export type SetupStage =
  | { kind: "unsupported"; browser: string }
  /** Chromium's live folder: choose one, or reconnect the remembered one. */
  | { kind: "folder"; pending: string | null }
  /** Rotli Helper isn't ready: not installed or paired, not running, refusing
   * our pairing, or too old to serve a vault. `vault` names the bound one. */
  | { kind: "helper"; problem: "missing" | "offline" | "refused" | "outdated"; vault: string | null }
  /** The helper is ready: pick the folder it serves (or keep the one it has). */
  | { kind: "vault"; served: HelperVaultInfo | null; expected: string | null };

export function setupStage(
  connection: VaultConnection,
  support: FolderSupport,
  linked: boolean,
  probe: HelperProbe | null,
): SetupStage {
  // Boot's answer about the helper is a snapshot: once setup has asked again
  // (paired, then probed), the live answer decides. A first request the
  // browser held behind its "connect to apps on this device?" question reads
  // as offline at boot and must not pin setup there after Allow (2026-09-23).
  const bootHelper =
    connection.status === "helper-offline" ||
    connection.status === "helper-refused" ||
    connection.status === "helper-outdated" ||
    connection.status === "helper-no-vault";
  if (bootHelper && linked && probe) {
    const vault = "name" in connection ? connection.name : null;
    // serving the bound vault reloads into it (checkHelper); anything else
    // it serves is another folder, named against the bound one
    if (probe.kind === "serving")
      return { kind: "vault", served: probe.info, expected: vault && probe.info ? vault : null };
    return { kind: "helper", problem: probe.kind, vault };
  }
  switch (connection.status) {
    case "unsupported":
      return { kind: "unsupported", browser: connection.browser };
    case "needs-permission":
      return { kind: "folder", pending: connection.name };
    case "helper-offline":
      return { kind: "helper", problem: "offline", vault: connection.name };
    case "helper-refused":
      return { kind: "helper", problem: linked ? "refused" : "missing", vault: connection.name };
    case "helper-outdated":
      return { kind: "helper", problem: "outdated", vault: connection.name };
    case "helper-no-vault":
      return { kind: "vault", served: null, expected: null };
    case "vault-mismatch":
      return {
        kind: "vault",
        served: probe?.kind === "serving" ? probe.info : null,
        expected: connection.expected,
      };
    case "connected":
    case "unbound":
      break;
  }
  if (support.kind === "live") return { kind: "folder", pending: null };
  if (!linked) return { kind: "helper", problem: "missing", vault: null };
  if (probe?.kind === "serving") return { kind: "vault", served: probe.info, expected: null };
  if (probe?.kind === "refused") return { kind: "helper", problem: "refused", vault: null };
  if (probe?.kind === "outdated") return { kind: "helper", problem: "outdated", vault: null };
  return { kind: "helper", problem: probe ? "offline" : "missing", vault: null };
}

const HEADINGS: Record<SetupStage["kind"], string> = {
  unsupported: "Rotli Web needs a computer",
  folder: "Choose your vault",
  helper: "Set up Rotli Helper",
  vault: "Choose your vault",
};

/** How often setup re-asks the helper while it waits for it. */
const POLL_MS = 1_500;

/** One look at Rotli Helper: adopt a pairing another tab made, ask what it
 * serves, and boot again once this browser's vault is ready. */
async function checkHelper(onProbe: (probe: HelperProbe) => void): Promise<void> {
  await adoptStoredPairing();
  const link = useHelperLink.getState().link;
  if (!link) return;
  const found = await probeHelper(link);
  onProbe(found);
  if (helperConnection(await loadHelperBinding(), found).status === "connected") window.location.reload();
}

export function WebVaultGate() {
  const connection = useVaultConnection((s) => s.connection);
  const link = useHelperLink((s) => s.link);
  const offeredCode = useHelperLink((s) => s.offeredCode);
  const support = browserFolderSupportSync();
  /** Paired in this tab: a success step, until the person presses Continue. */
  const [paired, setPaired] = useState(false);
  const [probe, setProbe] = useState<HelperProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stage = setupStage(connection, support, link !== null, probe);

  // Rotli Helper: keep asking until it answers, pairs (the installer's tab may
  // pair while this one waits), and serves — then boot again, connected.
  // Paused on the success step, so Continue — not a poll — moves on.
  const waitingOnHelper = (stage.kind === "helper" || stage.kind === "vault") && !paired;
  useEffect(() => {
    if (!waitingOnHelper) return;
    let live = true;
    const tick = () => {
      if (live) void checkHelper(setProbe);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [waitingOnHelper]);

  const fail = (reason: unknown) => {
    setBusy(false);
    setError(pickerFailure(reason));
  };

  /** Chromium: the picker must open inside this click. */
  const chooseFolder = () => {
    setBusy(true);
    setError(null);
    const action =
      stage.kind === "folder" && stage.pending !== null ? reconnectFolderVault() : connectFolderVault();
    action
      .then((granted) => {
        setBusy(false);
        if (granted === false) setError("The browser didn’t grant access to the vault. Try again.");
      })
      .catch(fail);
  };

  /** Helper: the folder picker opens on this computer, not in the page. */
  const chooseServed = () => {
    if (!link) return;
    setBusy(true);
    setError(null);
    chooseHelperVault(link)
      .then((chosen) => {
        setBusy(false);
        if (chosen !== "cancelled") window.location.reload();
      })
      .catch(fail);
  };

  const pickServed = (info: HelperVaultInfo) => {
    setBusy(true);
    saveHelperBinding(info)
      .then(() => window.location.reload())
      .catch(fail);
  };

  const [vaultChoice, setVaultChoice] = useState<"served" | "choose">("served");
  const served = stage.kind === "vault" ? stage.served : null;
  const vaultOptions: readonly SetupOption<"served" | "choose">[] = served
    ? [
        {
          value: "served",
          title: `Use “${served.name}”`,
          description: served.empty
            ? "An empty folder: it becomes a new vault, with the Welcome lessons."
            : "The folder Rotli Helper is serving now. It opens as it is.",
        },
        {
          value: "choose",
          title: "Choose a different folder…",
          description: "Your computer’s own folder picker opens. An empty folder becomes a new vault.",
        },
      ]
    : [];
  const choice = served ? vaultChoice : "choose";

  const primary = (): void => {
    if (busy) return;
    if (paired) setPaired(false);
    else if (stage.kind === "folder") chooseFolder();
    else if (stage.kind === "vault") {
      if (choice === "served" && served) pickServed(served);
      else chooseServed();
    } else if (stage.kind === "helper") void checkHelper(setProbe);
  };
  useEffect(() => {
    setSetupHandle({ continue: primary });
    return () => setSetupHandle(null);
  });

  const action = paired
    ? "Continue"
    : stage.kind === "folder"
      ? stage.pending !== null
        ? `Reconnect “${stage.pending}”`
        : "Choose vault…"
      : stage.kind === "vault"
        ? choice === "served" && served
          ? `Use “${served.name}”`
          : "Choose folder…"
        : stage.kind === "helper"
          ? "Check again"
          : null;

  return (
    <div className="onb vault-activation web-vault-gate">
      <section className="setup-shell" aria-labelledby="web-vault-title">
        <div className="setup-progress">
          <span>Rotli Web</span>
          <span aria-hidden="true">·</span>
          <span>{paired || stage.kind === "helper" ? "Helper" : "Vault"}</span>
        </div>

        <div className="setup-stage">
          <aside className="setup-companion" aria-hidden="true">
            <Character name="notes" size={152} accessorized={false} alwaysVisible />
            <p>
              Nothing leaves your computer. This page talks only to your own computer, and only to the folder
              you choose.
            </p>
          </aside>

          <div className="setup-content">
            <p className="setup-eyebrow">One folder is one vault</p>
            <h1 id="web-vault-title">{paired ? "Rotli Helper is paired" : HEADINGS[stage.kind]}</h1>
            {paired ? (
              <PairedBody />
            ) : (
              <StageBody
                stage={stage}
                support={support}
                offeredCode={offeredCode}
                onPaired={() => setPaired(true)}
              />
            )}
            {!paired && stage.kind === "vault" && served && (
              <SetupChoiceGroup
                label="Vault"
                value={vaultChoice}
                onChange={setVaultChoice}
                options={vaultOptions}
              />
            )}
            {busy && <p className="setup-lede">Waiting for your choice on this computer…</p>}
            {error && (
              <p className="setup-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        <footer className="setup-footer">
          <span className="setup-local-note">
            Your notes stay files in your folder, and nothing is sent anywhere.
          </span>
          {action && (
            <div className="setup-actions">
              <SetupPrimary disabled={busy} onClick={primary}>
                {action}
              </SetupPrimary>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}

/** The step after a Pair press lands: what pairing did, and what it can't do. */
function PairedBody() {
  return (
    <>
      <p className="setup-lede" role="status">
        This browser and Rotli Helper on this computer are connected. Next, choose the folder that holds your
        notes.
      </p>
      <div className="web-vault-gate-lines">
        <p>
          Rotli Helper reads and writes files in that folder directly on this computer, so every change is
          saved the moment you make it. The page talks to the helper at 127.0.0.1 only, never to the internet,
          and the helper never touches anything outside the folder you choose.
        </p>
      </div>
    </>
  );
}

function StageBody({
  stage,
  support,
  offeredCode,
  onPaired,
}: {
  stage: SetupStage;
  support: FolderSupport;
  offeredCode: string | null;
  onPaired: () => void;
}) {
  if (stage.kind === "unsupported") {
    return (
      <p className="setup-lede">
        Rotli Web keeps every note as a file in a folder on your computer, and {stage.browser} can’t connect
        one. Open this page in Chrome, Edge, Arc, Firefox, or Zen on a computer, or use{" "}
        <a href="/">Rotli for Mac</a>.
      </p>
    );
  }
  if (stage.kind === "folder") {
    return (
      <>
        <p className="setup-lede">
          {stage.pending !== null
            ? `Your vault “${stage.pending}” is on this computer. The browser asks once more before Rotli may open it.`
            : "Pick the folder that holds your notes, or an empty folder to start a new vault. Every note is a real file there, the same files Rotli for Mac reads."}
        </p>
        <div className="web-vault-gate-lines">
          <p>
            The browser asks whether Rotli may view and save changes to that folder. When you come back later
            it asks again. Choose <strong>Allow on every visit</strong> and it won’t ask after that.
          </p>
        </div>
      </>
    );
  }
  if (stage.kind === "vault") {
    return (
      <p className="setup-lede">
        {stage.expected
          ? `This browser opened “${stage.expected}”, but Rotli Helper now serves a different folder. Choose which vault to use.`
          : stage.served
            ? "Rotli Helper is ready. Use the folder it serves, or choose another."
            : "Rotli Helper is ready. Choose the folder that holds your notes, or an empty folder to start a new vault. The picker opens on your computer, not in this page."}
      </p>
    );
  }
  return <HelperStep stage={stage} support={support} offeredCode={offeredCode} onPaired={onPaired} />;
}

function HelperStep({
  stage,
  support,
  offeredCode,
  onPaired,
}: {
  stage: Extract<SetupStage, { kind: "helper" }>;
  support: FolderSupport;
  offeredCode: string | null;
  onPaired: () => void;
}) {
  const install = helperInstall(guideOs(navigator.platform || navigator.userAgent));
  const browser = support.kind === "import-only" ? support.browser : "This browser";
  const lede =
    stage.problem === "offline"
      ? `Rotli Helper isn’t answering${stage.vault ? `, so “${stage.vault}” can’t open` : ""}. It starts when you log in; to start it now, run it once. If your browser asked whether this page may connect to apps on this device, choose Allow.`
      : stage.problem === "refused"
        ? "Rotli Helper has a new pairing code (it was reinstalled). Paste the new code below."
        : stage.problem === "outdated"
          ? "This Rotli Helper is older than this page and can’t serve a vault yet. Run the same line again to update it."
          : `${browser} can’t write to a folder on its own. Rotli Helper is a small program for this computer that saves your notes into the folder you choose.`;
  return (
    <>
      <p className="setup-lede">{lede}</p>
      <ol className="guide-steps">
        <GuideStep
          n={1}
          done={stage.problem === "offline" || stage.problem === "refused"}
          title="Install Rotli Helper"
        >
          <CopyCommand command={stage.problem === "offline" ? install.start : install.command} />
          <span className="guide-step-detail">
            {stage.problem === "offline"
              ? "This starts it now. After that it starts by itself whenever you log in."
              : `${install.detail} It starts by itself whenever you log in, and it only ever reads and writes the folder you choose.`}
          </span>
        </GuideStep>
        <GuideStep n={2} done={false} title="Pair this browser">
          <span className="guide-step-detail">
            {offeredCode
              ? "The installer filled in this browser’s pairing code. Press Pair."
              : "The installer opens Rotli in a new tab with the pairing code filled in. Press Pair there."}
          </span>
          <PairingCodeForm
            key={offeredCode ?? ""}
            id="web-helper-code"
            label={offeredCode ? "Pairing code:" : "Or paste the pairing code the installer printed:"}
            initialCode={offeredCode ?? ""}
            onPaired={onPaired}
          />
        </GuideStep>
      </ol>
      {support.kind === "brave-off" && (
        <p className="setup-lede">
          In Brave you can skip the helper: turn on <code>brave://flags/#file-system-access-api</code>,
          relaunch, and choose your folder directly.
        </p>
      )}
    </>
  );
}
