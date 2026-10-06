// First run's sequence (the owner, 2026-10-01): you and your theme, your
// vault, the Librarian, your shortcuts; then the thank-you card, the tour,
// and a note at Settings for the rest. Also the vault screen outside setup,
// when the app has no vault. The screens themselves are onboarding.tsx and
// vaultActivation.tsx, split off the entry chunk (perf audit 2026-07-30, #18).

import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";

import { finishFirstRun } from "../../services/firstRun";
import { flushSettingsNow } from "../../state/persist";
import { type OnboardingPhase, useUiStore } from "../../state/ui";
import { type VaultStatus, useVaultStore } from "../../state/vault";

const Onboarding = lazy(() => import("./onboarding").then((m) => ({ default: m.Onboarding })));
const VaultActivation = lazy(() => import("./vaultActivation").then((m) => ({ default: m.VaultActivation })));
const VaultNeeded = lazy(() => import("./vaultNeeded").then((m) => ({ default: m.VaultNeeded })));

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

const flushQuietly = () => void flushSettingsNow().catch(() => {});

/** Where Skip setup goes: straight into the app when a vault is already
 * chosen, else to the one prompt for a folder. */
export function skipLeadsTo(vaultStatus: VaultStatus): "app" | "vaultPrompt" {
  return vaultStatus === "configured" ? "app" : "vaultPrompt";
}

/** The setup screen to show now, or null for the workspace. */
export function useSetupFront(onboardingActive: boolean, native: boolean): ReactNode | null {
  const phase = useUiStore((s) => s.onboardingPhase);
  const vaultStatus = useVaultStore((s) => s.status);
  // a vault switch reloads the corpus mid-setup; hold the vault screen until it lands
  const [vaultPending, setVaultPending] = useState(false);
  // back from a later screen keeps what was chosen (no intro, no reset)
  const [resumed, setResumed] = useState(false);
  const finish = () => finishFirstRun(APP_VERSION);
  const go = (next: OnboardingPhase, back = false) => {
    setResumed(back);
    useUiStore.getState().setOnboardingPhase(next);
    flushQuietly();
  };
  // skipped, and a vault is already chosen (the folder was picked but the
  // app quit before setup finished): there is nothing left to ask
  const skippedWithVault =
    onboardingActive && phase === "skipped" && !vaultPending && skipLeadsTo(vaultStatus) === "app";
  useEffect(() => {
    if (skippedWithVault) finishFirstRun(APP_VERSION);
  }, [skippedWithVault]);

  const screen = (node: ReactNode) => (
    <div className="app-window">
      <Suspense fallback={null}>{node}</Suspense>
    </div>
  );

  if (onboardingActive && phase === "preferences") {
    return screen(
      <Onboarding
        step="you"
        resumed={resumed}
        onDone={() => go("vault")}
        onSkip={() => {
          // Skip (the owner, 2026-10-05: "only required thing is a vault";
          // 2026-10-06: Skip goes straight to the app). With a vault already
          // chosen the app just opens; without one, it opens to a prompt.
          if (skipLeadsTo(vaultStatus) === "app") finish();
          else go("skipped");
        }}
      />,
    );
  }

  if (skippedWithVault) return null;
  if (onboardingActive && phase === "skipped") {
    return screen(
      <VaultNeeded
        onDone={() => {
          setVaultPending(false);
          finish();
        }}
        onBeforeSwitch={() => {
          setVaultPending(true);
          return flushSettingsNow();
        }}
        onSwitchFailed={() => {
          setVaultPending(false);
          return flushSettingsNow();
        }}
      />,
    );
  }

  const vaultUnconfigured = native && vaultStatus === "unconfigured" && !onboardingActive;
  if (vaultPending || (onboardingActive && phase === "vault") || vaultUnconfigured) {
    return screen(
      <VaultActivation
        onboarding={onboardingActive}
        allowCurrent={vaultStatus === "configured"}
        {...(onboardingActive
          ? {
              onBack: () => go("preferences", true),
              onDone: () => {
                setVaultPending(false);
                useUiStore.getState().setOnboardingPhase("librarian");
                return flushSettingsNow();
              },
              onBeforeSwitch: () => {
                setVaultPending(true);
                useUiStore.getState().setOnboardingPhase("librarian");
                return flushSettingsNow();
              },
              onSwitchFailed: () => {
                setVaultPending(false);
                useUiStore.getState().setOnboardingPhase("vault");
                return flushSettingsNow();
              },
            }
          : {})}
      />,
    );
  }

  if (onboardingActive && phase === "librarian") {
    return screen(
      <Onboarding
        step="librarian"
        onBack={() => go("vault", true)}
        onDone={() => go("shortcuts")}
        onSkip={finish}
      />,
    );
  }
  if (onboardingActive && phase === "shortcuts") {
    return screen(
      <Onboarding step="shortcuts" onBack={() => go("librarian", true)} onDone={finish} onSkip={finish} />,
    );
  }
  return null;
}
