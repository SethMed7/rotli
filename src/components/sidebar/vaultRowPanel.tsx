// A vault row's own actions, drawn IN the vault menu in place of the rows (the
// owner, 2026-10-10: the row's "…" made the whole menu vanish and a detached
// menu float over the panes). Back returns to the rows. Remove from Rotli asks
// once, says the folder and its files stay, and never deletes anything.

import { useEffect, useRef, useState } from "react";

import type { VaultRemovePlan } from "../../services/vaultSwitcher";

export function VaultRowPanel({
  label,
  plan,
  onBack,
  onLocationSettings,
  onRemove,
}: {
  label: string;
  plan: VaultRemovePlan;
  onBack: () => void;
  onLocationSettings: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), [confirming]);
  const back = confirming ? () => setConfirming(false) : onBack;

  return (
    <div className="vault-menu-panel">
      <button
        ref={backRef}
        type="button"
        className="vault-panel-item vault-menu-back"
        role="menuitem"
        onClick={back}
      >
        <span aria-hidden="true">‹</span>
        <span>{confirming ? "Back" : label}</span>
      </button>
      <div className="vault-panel-sep" role="separator" />
      {confirming ? (
        <>
          <p className="vault-menu-note">
            {plan.kind === "replace" ? (
              <>
                <strong>{label}</strong> is your only vault. Choose or make another one to use instead, then{" "}
                {label} is removed from Rotli.
              </>
            ) : (
              <>
                Remove <strong>{label}</strong> from Rotli?
                {plan.kind === "switch" ? ` Rotli switches to ${plan.to.label} first.` : ""}
              </>
            )}{" "}
            The folder and its files stay where they are. Nothing is deleted.
          </p>
          <button
            type="button"
            className="vault-panel-item vault-menu-danger"
            role="menuitem"
            onClick={onRemove}
          >
            {plan.kind === "replace" ? "Choose a vault…" : `Remove ${label}`}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="vault-panel-item" role="menuitem" onClick={onLocationSettings}>
            Location settings…
          </button>
          <button
            type="button"
            className="vault-panel-item vault-menu-danger"
            role="menuitem"
            onClick={() => setConfirming(true)}
          >
            Remove from Rotli…
          </button>
        </>
      )}
    </div>
  );
}
