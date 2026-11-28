// Where notes live, as one decision (the owner, 2026-10-01: "you either start
// fresh or connect a folder, that's it"; 2026-10-05: "always open native …
// they can do it from there"). One button opens the macOS folder panel; an
// empty folder (New Folder in the panel) becomes a fresh vault, and a folder
// that already holds notes asks once: a copy Rotli makes and opens
// (recommended), or the folder in place with only a hidden .rotli sidecar
// (services/vaultImport.ts). A Rotli vault opens as it is.

import { useEffect, useMemo, useState } from "react";

import { plainFirstRun, productName, setupOrder, setupStepWords } from "../../host/registry";
import {
  corpusInspectFolder,
  corpusStatus,
  type CorpusConfigView,
  corpusListConfig,
  type CorpusRefView,
} from "../../lib/tauri";
import { chooseFolder, initMemexAsCorpus, pickVaultFolder } from "../../memex/service";
import { activateCreatedVault, refreshActiveVault } from "../../state/activeVault";
import { openRequestGate } from "../../state/openRequestGate";
import { flushSettingsNow } from "../../state/persist";
import { stepAfter } from "../../state/setupSequence";
import { useUiStore } from "../../state/ui";
import { Character } from "../character";
import { StepBlocks, stepBlocks, useStepReady } from "./hostSetup";
import { OnboardingScenery } from "./onboardingScenery";
import {
  LIBRARIAN_ON_DESCRIPTION,
  SetupBack,
  SetupChoiceGroup,
  SetupPrimary,
  useSetupHandle,
} from "./setupControls";

/** The vault setup may offer to keep: the one this install has chosen. A
 * debug build only borrows production's vault, read-only, to boot; keeping
 * that would record nothing, so setup would ask again on the next launch. */
export function keepableVault(
  config: Pick<CorpusConfigView, "corpus" | "developmentReadOnly">,
): CorpusRefView | null {
  return config.developmentReadOnly ? null : config.corpus;
}

/** After opening a folder: carry on only when it really is the vault now. A
 * folder already open here is a no-op, which is fine for a vault this install
 * chose; a debug build only borrows production's vault read-only, so "opening"
 * it records nothing, and setup would end on the vault screen again. */
export function openedOrWhy(opened: boolean, configured: boolean): string | null {
  if (opened || configured) return null;
  return `That folder is already open here read-only, so ${productName()} can't keep it as this build's vault. Pick another folder.`;
}

/** What a picked folder becomes: an empty one a fresh vault, anything else
 * the vault it already is, used in place. */
export function vaultPlan(kind: "memex" | "markdown" | "empty"): "create" | "open" {
  return kind === "empty" ? "create" : "open";
}

/** Picking the folder, shared by setup's vault step and the prompt a skipped
 * setup shows: the folder panel, then a fresh vault or the folder used in
 * place. `librarian` is whether a NEW vault's Librarian starts on. */
export function useVaultChoice({
  librarian,
  onDone,
  onBeforeSwitch,
  onSwitchFailed,
}: {
  librarian: () => boolean;
  /** Told the folder that became the vault. */
  onDone?: ((path: string) => void | Promise<void>) | undefined;
  onBeforeSwitch?: (() => void | Promise<void>) | undefined;
  onSwitchFailed?: (() => void | Promise<void>) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restoreVaultStep = async () => {
    try {
      await onSwitchFailed?.();
    } catch {
      // Preserve the real vault-operation error below; persistence will retry.
    }
  };

  /** Pick the folder, and that's the vault: made fresh, or used in place. */
  const choose = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    let releaseOpenRequests: (moved: boolean) => void = () => {};
    let vaultMoved = false;
    try {
      const path = await pickVaultFolder("Choose a folder for your notes");
      if (!path) return;
      // a read-only look first decides what the folder becomes
      const inspection = await corpusInspectFolder(path);
      const plan = vaultPlan(inspection.kind);
      /** True when the vault moved; false when that folder is already open. */
      const openInPlace = async () => {
        const moved = await chooseFolder(path);
        if (moved) {
          await refreshActiveVault();
        } else {
          const why = openedOrWhy(false, await corpusStatus());
          if (why) throw new Error(why);
        }
        return moved;
      };
      await onBeforeSwitch?.();
      await flushSettingsNow();
      releaseOpenRequests = await openRequestGate.holdForSwitch();
      if (plan === "create") {
        await initMemexAsCorpus(path, librarian());
        await activateCreatedVault();
        vaultMoved = true;
      } else {
        // a vault, or someone's notes: used in place. Setup never asks about
        // a copy; the Librarian is its own step, and only it would need one
        vaultMoved = await openInPlace();
      }
      await onDone?.(path);
    } catch (cause) {
      await restoreVaultStep();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      releaseOpenRequests(vaultMoved);
      setBusy(false);
    }
  };

  return { choose, busy, setBusy, error, chooseLabel: busy ? "Working…" : "Choose a folder" };
}

export function VaultActivation({
  onboarding = false,
  allowCurrent = false,
  onDone,
  onPicked,
  onBack,
  onSkip,
  onBeforeSwitch,
  onSwitchFailed,
}: {
  onboarding?: boolean;
  allowCurrent?: boolean;
  onDone?: () => void | Promise<void>;
  /** A plain first run's folder row (host/registry.ts, HostFirstRun): a pick
   * stays on this step and calls this; the primary then calls onDone. */
  onPicked?: () => void | Promise<void>;
  onBack?: () => void;
  /** A plain first run's "Skip the rest" (setupFlow.tsx). */
  onSkip?: () => void;
  onBeforeSwitch?: () => void | Promise<void>;
  onSwitchFailed?: () => void | Promise<void>;
}) {
  const plain = plainFirstRun();
  const rows = onboarding && plain && onPicked !== undefined;
  const order = setupOrder();
  const words = onboarding ? setupStepWords("vault") : {};
  const blocks = useMemo(() => (onboarding ? stepBlocks("vault") : { before: [], after: [] }), [onboarding]);
  const ready = useStepReady(useMemo(() => [...blocks.before, ...blocks.after], [blocks]));
  // outside setup no Librarian screen follows, so a new vault asks here
  const [librarian, setLibrarian] = useState<"on" | "off">("on");
  const [current, setCurrent] = useState<CorpusRefView | null>(null);
  // the folder a plain first run's row picked, by name
  const [picked, setPicked] = useState<string | null>(null);
  // in setup, whether the Librarian works here is the next screen's question
  const { choose, busy, setBusy, error, chooseLabel } = useVaultChoice({
    librarian: () => (onboarding ? useUiStore.getState().brainEnabled : librarian === "on"),
    onDone: rows
      ? async (path) => {
          setPicked(path.split("/").filter(Boolean).pop() ?? path);
          await onPicked?.();
        }
      : onDone,
    onBeforeSwitch,
    onSwitchFailed,
  });

  useEffect(() => {
    if (!onboarding || !allowCurrent) return;
    let live = true;
    void corpusListConfig()
      .then((config) => {
        if (live) setCurrent(keepableVault(config));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [allowCurrent, onboarding]);

  /** Re-onboarding with a vault already chosen: keep it, no folder panel. */
  const keepCurrent = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDone?.();
    } finally {
      setBusy(false);
    }
  };

  const folder = picked ?? (current ? current.absPath.split("/").pop() || "this vault" : null);
  // the row's step moves on once a folder is chosen and the host's blocks allow it
  const canFinish = folder !== null && ready && !busy;
  const primary = rows ? () => void (canFinish && keepCurrent()) : () => void choose();
  useSetupHandle(primary, onBack);
  const next = onboarding ? stepAfter("vault", order) : null;

  return (
    <div className="onb vault-activation" data-look={plain && onboarding ? "plain" : undefined}>
      <div className="onb-drag" data-tauri-drag-region />
      {!(plain && onboarding) && <OnboardingScenery />}
      <section className="setup-shell" aria-labelledby="vault-title">
        <div className="setup-progress">
          <span>{onboarding ? `${order.indexOf("vault") + 1} of ${order.length}` : "Vault"}</span>
          <span aria-hidden="true">·</span>
          <span>{words.label ?? "Vault"}</span>
        </div>

        <div className="setup-stage">
          {!(plain && onboarding) && (
            <aside className="setup-companion" aria-hidden="true">
              <Character name={busy ? "searching" : "notes"} size={152} />
              <p>Your notes stay ordinary files you own.</p>
            </aside>
          )}

          <div className="setup-content">
            <h1 id="vault-title">{words.title ?? "Where should your notes live?"}</h1>
            <p className="setup-lede">
              {words.lede ??
                `Pick a folder for your notes. Make a new one with New Folder and ${productName()} starts a fresh vault there, or pick the Markdown folder you already use, like an Obsidian vault: it stays as it is, and ${productName()} adds only a hidden .rotli folder.`}
            </p>
            <StepBlocks blocks={blocks.before} />
            {rows && (
              <div className="setup-row">
                <span className="setup-row-copy">
                  <strong>Notes folder</strong>
                  <span>
                    {folder
                      ? `Your notes live in “${folder}”. Choose another to change it.`
                      : "An empty folder starts a new vault. A folder that already holds Markdown files opens as it is."}
                  </span>
                </span>
                <button
                  type="button"
                  className="setup-button secondary"
                  disabled={busy}
                  onClick={() => void choose()}
                >
                  {busy ? "Working…" : folder ? "Choose another…" : "Choose folder…"}
                </button>
              </div>
            )}
            <StepBlocks blocks={blocks.after} />
            {!onboarding && (
              <SetupChoiceGroup
                label="Librarian choice"
                value={librarian}
                onChange={setLibrarian}
                options={[
                  {
                    value: "on",
                    title: "A new vault with the Librarian",
                    description: LIBRARIAN_ON_DESCRIPTION,
                  },
                  {
                    value: "off",
                    title: "Raw vault",
                    description:
                      "You arrange your notes yourself. Turn the Librarian on anytime in Settings.",
                  },
                ]}
              />
            )}
            {rows && !folder && (
              <p className="setup-local-note">The next step waits until a folder is chosen.</p>
            )}
            {error && (
              <p className="setup-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        <footer className="setup-footer">
          {rows && onSkip ? (
            <button type="button" className="setup-skip" onClick={onSkip}>
              Skip the rest
            </button>
          ) : (
            <span className="setup-local-note">Local files remain the durable truth.</span>
          )}
          <div className="setup-actions">
            {onBack && <SetupBack disabled={busy} onClick={onBack} />}
            {current && !rows && (
              <button
                type="button"
                className="setup-button secondary"
                disabled={busy}
                onClick={() => void keepCurrent()}
              >
                Keep {current.absPath.split("/").pop() || "this vault"}
              </button>
            )}
            {rows ? (
              <SetupPrimary disabled={!canFinish} onClick={primary}>
                {words.primary ?? (next === null ? "Finish setup" : "Continue")}
              </SetupPrimary>
            ) : (
              <SetupPrimary disabled={busy || !ready} onClick={primary}>
                {chooseLabel}
              </SetupPrimary>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
