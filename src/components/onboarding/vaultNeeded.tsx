// After Skip setup with no vault yet (the owner, 2026-10-06: Skip should go
// straight to the app, then a prompt that a vault is needed — not a screen
// that looks like setup's next step). The app's own empty window sits behind
// one small prompt. A vault is the one thing setup can't skip, so the prompt
// has a single action and no way around it. A window with no vault has no
// notes to show yet, so the backdrop is the empty pane's scene, never a
// workspace whose every list would fail.

import { useUiStore } from "../../state/ui";
import { PaneScene } from "../paneEmptyState";
import { useSetupHandle } from "./setupControls";
import { useVaultChoice } from "./vaultActivation";

export function VaultNeeded({
  onDone,
  onBeforeSwitch,
  onSwitchFailed,
}: {
  onDone: () => void | Promise<void>;
  onBeforeSwitch?: () => void | Promise<void>;
  onSwitchFailed?: () => void | Promise<void>;
}) {
  const { choose, busy, error, chooseLabel } = useVaultChoice({
    // Skip keeps every default, the Librarian's included
    librarian: () => useUiStore.getState().brainEnabled,
    onDone,
    onBeforeSwitch,
    onSwitchFailed,
  });
  const primary = () => void choose();
  // ⌘↩ chooses; there is no Back from a skip
  useSetupHandle(primary);

  return (
    <div className="vault-needed">
      <div className="onb-drag" data-tauri-drag-region />
      <div className="vault-needed-stack">
        <PaneScene />
        <div
          className="rename-card vault-needed-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vault-needed-title"
          aria-describedby="vault-needed-text"
          aria-busy={busy}
        >
          <h2 id="vault-needed-title" className="vault-needed-title">
            Rotli needs a folder for your notes
          </h2>
          <p id="vault-needed-text" className="vault-needed-text">
            It’s the one part of setup you can’t skip. Pick a new folder and Rotli starts a fresh vault there,
            or pick the Markdown folder you already use, like an Obsidian vault: it stays as it is.
          </p>
          {error && (
            <p role="alert" className="rename-error">
              {error}
            </p>
          )}
          <div className="rename-actions">
            <button type="button" className="rename-btn primary" disabled={busy} onClick={primary}>
              {chooseLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
