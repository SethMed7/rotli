// Where notes live, as one decision (the owner, 2026-10-01: "you either start
// fresh or connect a folder, that's it"; 2026-10-05: "always open native …
// they can do it from there"). One button opens the macOS folder panel; an
// empty folder (New Folder in the panel) becomes a fresh vault, a folder that
// already holds notes is used in place with only a hidden .rotli sidecar.
// Picking the folder is the confirmation.

import { useEffect, useState } from "react";

import {
  corpusInspectFolder,
  corpusStatus,
  type CorpusConfigView,
  corpusListConfig,
  type CorpusRefView,
} from "../../lib/tauri";
import { chooseFolder, initMemexAsCorpus, pickVaultFolder } from "../../memex/service";
import { activateCreatedVault, refreshActiveVault } from "../../state/activeVault";
import { ONBOARDING_STEP_NUMBER, ONBOARDING_TOTAL_STEPS } from "../../state/onboarding";
import { flushSettingsNow } from "../../state/persist";
import { useUiStore } from "../../state/ui";
import { Character } from "../character";
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
  return "That folder is already open here read-only, so Rotli can't keep it as this build's vault. Pick another folder.";
}

/** What a picked folder becomes: an empty one a fresh vault, anything else
 * the vault it already is, used in place. */
export function vaultPlan(kind: "memex" | "markdown" | "empty"): "create" | "open" {
  return kind === "empty" ? "create" : "open";
}

export function VaultActivation({
  onboarding = false,
  allowCurrent = false,
  onDone,
  onBack,
  onBeforeSwitch,
  onSwitchFailed,
  skipping = false,
}: {
  /** The person skipped setup: this screen is the one thing left. */
  skipping?: boolean;
  onboarding?: boolean;
  allowCurrent?: boolean;
  onDone?: () => void | Promise<void>;
  onBack?: () => void;
  onBeforeSwitch?: () => void | Promise<void>;
  onSwitchFailed?: () => void | Promise<void>;
}) {
  // outside setup no Librarian screen follows, so a new vault asks here
  const [librarian, setLibrarian] = useState<"on" | "off">("on");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<CorpusRefView | null>(null);

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
    try {
      const path = await pickVaultFolder("Choose a folder for your notes");
      if (!path) return;
      // a read-only look first decides what the folder becomes
      const plan = vaultPlan((await corpusInspectFolder(path)).kind);
      await onBeforeSwitch?.();
      await flushSettingsNow();
      if (plan === "create") {
        // in setup, whether the Librarian works here is the next screen's question
        await initMemexAsCorpus(path, onboarding ? useUiStore.getState().brainEnabled : librarian === "on");
        await activateCreatedVault();
      } else if (await chooseFolder(path)) {
        await refreshActiveVault();
      } else {
        const why = openedOrWhy(false, await corpusStatus());
        if (why) throw new Error(why);
      }
      await onDone?.();
    } catch (cause) {
      await restoreVaultStep();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

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

  const primary = () => void choose();
  useSetupHandle(primary, onBack);

  return (
    <div className="onb vault-activation">
      <div className="onb-drag" data-tauri-drag-region />
      <OnboardingScenery />
      <section className="setup-shell" aria-labelledby="vault-title">
        <div className="setup-progress">
          <span>{onboarding ? `${ONBOARDING_STEP_NUMBER.vault} of ${ONBOARDING_TOTAL_STEPS}` : "Vault"}</span>
          <span aria-hidden="true">·</span>
          <span>Vault</span>
        </div>

        <div className="setup-stage">
          <aside className="setup-companion" aria-hidden="true">
            <Character name={busy ? "searching" : "notes"} size={152} />
            <p>Your notes stay ordinary files you own.</p>
          </aside>

          <div className="setup-content">
            <h1 id="vault-title">Where should your notes live?</h1>
            <p className="setup-lede">
              {skipping
                ? "One thing before you start: pick a folder for your notes. "
                : "Pick a folder for your notes. "}
              Make a new one with New Folder and Rotli starts a fresh vault there, or pick the Markdown folder
              you already use, like an Obsidian vault: it stays as it is, and Rotli adds only a hidden .rotli
              folder.
            </p>
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
            {error && (
              <p className="setup-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        <footer className="setup-footer">
          <span className="setup-local-note">Local files remain the durable truth.</span>
          <div className="setup-actions">
            {onBack && <SetupBack disabled={busy} onClick={onBack} />}
            {current && (
              <button
                type="button"
                className="setup-button secondary"
                disabled={busy}
                onClick={() => void keepCurrent()}
              >
                Keep {current.absPath.split("/").pop() || "this vault"}
              </button>
            )}
            <SetupPrimary disabled={busy} onClick={primary}>
              {busy ? "Working…" : "Choose a folder"}
            </SetupPrimary>
          </div>
        </footer>
      </section>
    </div>
  );
}
