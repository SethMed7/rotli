import "./styles/base.css";
import "./styles/app.css";
import "./styles/notes.css";
import "./styles/editor.css";
import "./styles/render.css";
import "./styles/command.css";
import "./styles/quick.css";
import "./styles/onboarding.css";
import "./styles/board.css";
import "./styles/memex.css";
import "./styles/breve.css";
import { useEffect, useState } from "react";
// Excalidraw's vendor stylesheet (~144 KB raw / 23 KB gz) + canvas.css are no
// longer eager here — they load with the lazy board engine (boards/engine/
// excalidraw.tsx), so a session that never opens a board never pays for them at
// startup (perf audit 2026-08).
import { Suspense, lazy } from "react";

import { CaptureCard } from "./components/captureCard";
import { ContextMenu } from "./components/contextMenu";
import { GuidedTour } from "./components/tour/guidedTour";
import { HotkeyBadges } from "./components/hotkeyBadges";
import { NotesSurface } from "./components/notesSurface";
import { PreviewModal } from "./components/previewModal";
import { QuickNote } from "./components/quickNote";
import { RenameDialog } from "./components/renameDialog";
import { BoardNameDialog } from "./components/boardNameDialog";
import { Titlebar } from "./components/titlebar";
import { WhichKey } from "./components/whichKey";
import { VaultFolderBrowser } from "./components/vaultFolderBrowserDialog";
import { registerDefaultActions } from "./keys/actions";
import { type Surface, applyRebind, attachDispatcher, dispatch } from "./keys/registry";
import { hotkeyPeekDelay, useHeldModifier } from "./keys/useHeldModifier";
import {
  emitCaptureAck,
  isTauri,
  onBrainJournal,
  onCaptureSave,
  onCorpusChanged,
  onNativeCloseTab,
  onOpenRequest,
  onOrganizerProgress,
  onQuickCreated,
  onQuickSet,
  onRebind,
  onSummonChat,
  onSummonSearch,
  onVaultChanged,
  setAppIcon,
  setDockVisible,
  setHideOnBlur,
  workspaceTakeOpenRequest,
} from "./lib/tauri";
import { useNativeFileDrop } from "./editor/nativeFileDrop";
import { onQuitFlushFailure } from "./lib/quitFlush";
import { isOnboardingReview } from "./lib/reviewMode";
import { fileQuickNoteInMain } from "./newItems/composition";
import { createVaultCapture } from "./services/captureRouting";
import { summonChat } from "./services/chatSummon";
import { DEST } from "./services/destinations";
import { invalidateFolders, invalidateJournal, invalidateNotes } from "./services/hooks";
import { adoptPendingAtOrganize } from "./services/librarianAutoAdopt";
import { notesService } from "./services/notes";
import { openSeededWelcome } from "./services/welcome";
import { queryClient } from "./services/query";
import { hydrateMain } from "./state/main";
import { onboardingRequired } from "./state/onboarding";
import { useOrganizerLive } from "./state/organizerLive";
import { activeTabOf, leaves, usePanesStore } from "./state/panes";
import { invalidateMemex } from "./memex/useMemex";
import { invalidateChatFolders } from "./services/chatFolders";
import { refreshAfterExternalCorpusChange } from "./services/externalCorpusChange";
import { refreshActiveVault } from "./state/activeVault";
import { flushSettingsNow, runAutoRetentionMaintenance } from "./state/persist";
import { applyQuickState } from "./state/quick";
import { useAppearanceSync } from "./state/appearanceSync";
import { applyAccent, applySyntaxPalette, applyTheme } from "./state/theme";
import { startTour } from "./state/tour";
import { useUiStore } from "./state/ui";
import { useVaultStore } from "./state/vault";
import { hydrateViews } from "./state/views";

// Settings and Onboarding are full-surface fronts most sessions never (or
// once) open — split them off the entry chunk like paneTree's CanvasSurface
// (perf audit 2026-07-30, #18). Suspense falls back to nothing for a frame.
const SettingsSurface = lazy(() =>
  import("./components/settingsSurface").then((m) => ({
    default: m.SettingsSurface,
  })),
);
const Onboarding = lazy(() =>
  import("./components/onboarding/onboarding").then((m) => ({
    default: m.Onboarding,
  })),
);
const VaultActivation = lazy(() =>
  import("./components/onboarding/vaultActivation").then((m) => ({
    default: m.VaultActivation,
  })),
);
const ModelSetup = lazy(() =>
  import("./components/onboarding/modelSetup").then((m) => ({
    default: m.ModelSetup,
  })),
);

registerDefaultActions();

if (import.meta.env.DEV) {
  // Review automation can drive any registry action (__rotli.dispatch) and
  // observe cache behavior (__rotli.queryClient — the e2e proof that typing
  // no longer refetches the notes universe, audit 2026-07-30 #1).
  (
    window as Window & {
      __rotli?: {
        dispatch: (actionId: string) => void;
        queryClient: typeof queryClient;
      };
    }
  ).__rotli = {
    dispatch,
    queryClient,
  };
}

/** Which surface this webview shows. Default = the main window;
 *  `?window=capture` = the quick-capture card; `?window=quick` = the floating
 *  Quick Note window. */
function surfaceFromUrl(): Surface {
  const param = new URLSearchParams(window.location.search).get("window");
  if (param === "capture") return "capture";
  if (param === "quick") return "quick";
  return "main";
}

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

// The onboardingVersion gate. While 0.x (beta), re-onboard on EVERY version change
// (the flow keeps evolving). Post-1.0, freeze the bar at 1.0.0 so updates never
// re-onboard — only a fresh install (no prior onboardingVersion) does.
const REQUIRED_ONBOARDING_VERSION =
  (Number.parseInt(APP_VERSION.split(".")[0] ?? "0", 10) || 0) >= 1 ? "1.0.0" : APP_VERSION;

function MainShell() {
  const [resumeAtShortcuts, setResumeAtShortcuts] = useState(false);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const transientCount = useUiStore((s) => s.transients.length);
  const focusMode = useUiStore((s) => s.focusMode);
  const onboarded = useUiStore((s) => s.onboarded);
  const setOnboarded = useUiStore((s) => s.setOnboarded);
  const onboardingVersion = useUiStore((s) => s.onboardingVersion);
  const setOnboardingVersion = useUiStore((s) => s.setOnboardingVersion);
  const onboardingPhase = useUiStore((s) => s.onboardingPhase);
  const [vaultActivationPending, setVaultActivationPending] = useState(false);
  const setOnboardingPhase = useUiStore((s) => s.setOnboardingPhase);
  const vaultStatus = useVaultStore((s) => s.status);
  const mainAutoRemoveDays = useUiStore((s) => s.mainAutoRemoveDays);
  const chatAutoArchiveDays = useUiStore((s) => s.chatAutoArchiveDays);
  // first run (the real app only). The version gate ALSO re-onboards on every 0.x
  // update — bulletproof regardless of the `onboarded` flag's state on disk.
  const onboardingActive = onboardingRequired(
    isTauri() || isOnboardingReview(isTauri(), import.meta.env.DEV, window.location.search),
    onboarded,
    onboardingVersion,
    REQUIRED_ONBOARDING_VERSION,
  );
  const showOnboarding = onboardingActive && onboardingPhase === "preferences";
  const showModelSetup = onboardingActive && onboardingPhase === "models" && !vaultActivationPending;
  const showVaultActivation =
    vaultActivationPending ||
    (onboardingActive && onboardingPhase === "vault") ||
    (isTauri() && vaultStatus === "unconfigured" && !onboardingActive);

  // A lone ⌘ reveals shortcut help immediately in the normal workspace. When
  // a modal/popover owns attention, keep the deliberate hold threshold so a
  // model picker or menu does not flash the HUD during ordinary commands.
  const [whichKey, setWhichKey] = useState(false);
  // WHAT the hold reveals is the user's call (the maintainer, 2026-08-04): badges pinned
  // to the controls themselves (default), the original grouped panel, or off.
  const hotkeyPeek = useUiStore((s) => s.hotkeyPeek);
  useHeldModifier({
    modifier: "Meta",
    delayMs: hotkeyPeekDelay(transientCount > 0 || paletteOpen),
    enabled:
      hotkeyPeek !== "off" && !settingsOpen && !showOnboarding && !showVaultActivation && !showModelSetup,
    onHold: () => setWhichKey(true),
    onRelease: () => setWhichKey(false),
  });

  // focus mode is window-wide: chrome everywhere reacts to one attribute
  useEffect(() => {
    if (focusMode) document.documentElement.dataset.focus = "true";
    else delete document.documentElement.dataset.focus;
  }, [focusMode]);

  // One composition-owned housekeeping trigger. It runs after opt-in/settings
  // changes and whenever the app becomes visible again. No background timer:
  // a tucked-away local-first app should remain completely idle.
  useEffect(() => {
    if (mainAutoRemoveDays === null && chatAutoArchiveDays === null) return;
    const run = () => {
      void runAutoRetentionMaintenance().then(() => {
        void Promise.all([invalidateNotes(), invalidateMemex()]);
      });
    };
    run();
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [chatAutoArchiveDays, mainAutoRemoveDays]);

  // the capture card lives in another webview; this window owns the corpus — it
  // drops the capture onto the BOARD as a card (a real .md in Board/, NOT a note
  // in your list), then acks so the card may clear. Plain Enter never surfaces
  // the app (open=false); ⌘Enter (open=true) opens the Board so you can see it.
  //
  // With a writable destination memex, ⌥C lands as a STAGED NOTE in wiki/_inbox/ instead (no
  // Board card; inbox.md is not a rotli write surface — #96, audit 2026-07). The
  // An explicit vault choice is exact: if it becomes unavailable, the draft is
  // left un-acked rather than silently written elsewhere. The default route may
  // still fall back to the Board so existing local setups keep working.
  useEffect(
    () =>
      onCaptureSave(({ id, body, open }) => {
        const toBoard = async () => {
          await notesService.createNote(DEST.board, body, { secure: true });
          await invalidateNotes();
          if (open) useUiStore.getState().setContentView("board");
        };
        void (async () => {
          let saved = false;
          const targetId = useUiStore.getState().captureVaultId;
          try {
            const noteId = await createVaultCapture(targetId, body);
            if (noteId) {
              // a quick capture is a STAGED NOTE (wiki/_secure, secure at birth,
              // capture shelf) → Rust projects it to the one Captures surface
              // (the maintainer, 2026-06-30). ⌘Enter surfaces Captures.
              await invalidateNotes();
              if (open) useUiStore.getState().setContentView("board");
            } else {
              await toBoard();
            }
            saved = true;
          } catch {
            // The default route keeps its legacy local fallback. An explicit
            // target never misfiles: leave the draft un-acked for the next summon.
            if (targetId) return;
            try {
              await toBoard();
              saved = true;
            } catch {
              /* total failure — leave the draft UN-acked so the next summon resumes it */
            }
          }
          // ack ONLY on a confirmed save: the ack clears the card's draft, so on
          // total failure we must NOT ack (a capture must never be lost)
          if (saved) emitCaptureAck(id);
        })();
      }),
    [],
  );

  // the corpus changed UNDER the app (a folder dropped in, a note edited in
  // another editor) — refetch everything; content appears when ready
  useEffect(
    () =>
      onCorpusChanged(() => {
        void refreshAfterExternalCorpusChange({
          folders: invalidateFolders,
          notes: invalidateNotes,
          chats: invalidateMemex,
          chatFolders: invalidateChatFolders,
          main: hydrateMain,
          views: hydrateViews,
          // the same watcher callback that emits this ALSO feeds the daemon's
          // queue, so organizer status moves here — event, not a 60s poll.
          journal: invalidateJournal,
        });
      }),
    [],
  );

  // `rotli open <id>` (CLI/MCP) writes one tiny request beside the corpus
  // sidecars, then activates the app — Rust forwards that activation as
  // "rotli:open-request" (perf audit 2026-07-30, #15: this was a 750ms poll
  // for the app's lifetime, ~115k IPC calls/day). Consume once at startup for
  // a request queued while Rotli wasn't running, then on each event.
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let reading = false;
    const consume = () => {
      if (reading || stopped) return;
      reading = true;
      void workspaceTakeOpenRequest()
        .then((request) => {
          if (!request || stopped) return;
          useUiStore.getState().setContentView("panes");
          usePanesStore.getState().openSummary(request);
        })
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    };
    consume();
    const unlisten = onOpenRequest(consume);
    return () => {
      stopped = true;
      unlisten();
    };
  }, []);

  // AppKit owns menu accelerators before WKWebView. Rust replaces the default
  // Close Window ⌘W with Close Tab and forwards it here so native, browser,
  // and button closes all use the one registry action.
  useEffect(() => onNativeCloseTab(() => dispatch("tabs.close")), []);

  // the daemon journaled (a proposal or an auto-applied action) — refetch the
  // journal (Activity + the sidebar badge) AND the notes an apply may have
  // moved. At Organize, stale metadata suggestions also adopt themselves
  // (the maintainer, 2026-07-31: "it is working for me in the back") — same guarded
  // approve lane the buttons use, journaled and undoable.
  useEffect(
    () =>
      onBrainJournal(() => {
        void invalidateJournal();
        void invalidateNotes();
        void adoptPendingAtOrganize();
      }),
    [],
  );
  // and once at startup — a backlog left by an older version clears itself
  useEffect(() => {
    if (!isTauri()) return;
    void adoptPendingAtOrganize();
  }, []);

  // the ambient working signal (the maintainer, 2026-07-31): the daemon's narration
  // feeds a tiny store the sidebar's footer dot reads — the Librarian's work
  // is visible from anywhere, not only inside its surface
  useEffect(
    () =>
      onOrganizerProgress((p) => {
        const live = useOrganizerLive.getState();
        if (p.phase === "start") live.setLive(true);
        else if (p.phase === "note") live.setLive(true, p.title ?? null);
        else live.setLive(false);
        // a cycle boundary is where daemon STATUS moves (busy, the queue
        // draining, last run/error, the secure-skip set) — Activity and the
        // sidebar badge read it from this event instead of a 60s poll (perf
        // audit 2026-07-30, finding 23). Per-note ticks carry no status change.
        if (p.phase !== "note") void invalidateJournal();
      }),
    [],
  );

  // ⌥A fired OS-side (Rust already showed the window) — land in a chat
  useEffect(() => onSummonChat(() => void summonChat()), []);

  // ⌥F fired OS-side — land in the ⌘K palette ("find", ⌥A's search twin)
  useEffect(() => onSummonSearch(() => useUiStore.getState().setPaletteOpen(true)), []);

  // Finder drops: preview line while hovering, insertion at the drop (or the
  // hovered/focused editor), storage for everything else
  useNativeFileDrop();

  // fs mode: the window opens on the freshest note. The in-memory seed decides
  // this synchronously at module init; the disk corpus answers async — fill
  // the pristine startup tab once, never replacing anything the user opened.
  useEffect(() => {
    if (!isTauri()) return;
    void notesService.listNotes().then((notes) => {
      const freshest = notes[0];
      if (!freshest) return;
      const { root, openNote } = usePanesStore.getState();
      const panes = leaves(root);
      const only = panes[0];
      const onlyTab = only && only.tabs.length === 1 ? activeTabOf(only) : null;
      const pristine =
        panes.length === 1 && !!onlyTab && onlyTab.surfaceKind === "note" && onlyTab.noteId === "";
      if (pristine) openNote(freshest.id);
    });
  }, []);

  // While onboarding, the window must NOT vanish on blur (it normally hides) —
  // the flow would disappear the moment focus slips. The real behavior is
  // (re)applied on finish from the user's chosen Stay-open value.
  useEffect(() => {
    if (showOnboarding || showVaultActivation || showModelSetup) void setHideOnBlur(false);
  }, [showOnboarding, showVaultActivation, showModelSetup]);

  if (showOnboarding) {
    return (
      <div className="app-window">
        <Suspense fallback={null}>
          <Onboarding
            initialStep={resumeAtShortcuts ? "shortcuts" : "welcome"}
            onDone={() => {
              setResumeAtShortcuts(false);
              setOnboardingPhase("vault");
              void flushSettingsNow().catch(() => {});
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (showVaultActivation) {
    return (
      <div className="app-window">
        <Suspense fallback={null}>
          <VaultActivation
            onboarding={onboardingActive}
            allowCurrent={vaultStatus === "configured"}
            {...(onboardingActive
              ? {
                  onBack: () => {
                    setResumeAtShortcuts(true);
                    setOnboardingPhase("preferences");
                    void flushSettingsNow().catch(() => {});
                  },
                  onDone: () => {
                    setVaultActivationPending(false);
                    setOnboardingPhase("models");
                    return flushSettingsNow();
                  },
                  onBeforeSwitch: () => {
                    setVaultActivationPending(true);
                    setOnboardingPhase("models");
                    return flushSettingsNow();
                  },
                  onSwitchFailed: () => {
                    setVaultActivationPending(false);
                    setOnboardingPhase("vault");
                    return flushSettingsNow();
                  },
                }
              : {})}
          />
        </Suspense>
      </div>
    );
  }

  if (showModelSetup) {
    return (
      <div className="app-window">
        <Suspense fallback={null}>
          <ModelSetup
            onBack={() => {
              setOnboardingPhase("vault");
              void flushSettingsNow().catch(() => {});
            }}
            onDone={() => {
              setOnboarded(true);
              openSeededWelcome();
              startTour();
              setOnboardingVersion(APP_VERSION);
              setOnboardingPhase("preferences");
              const ui = useUiStore.getState();
              void setHideOnBlur(!ui.stayOpen);
              void setDockVisible(ui.showInDock);
              void flushSettingsNow().catch(() => {});
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="app-window">
      <Titlebar />
      <main className="app-content">
        {/* Settings is the one full-surface front. Chat · Board · All-notes ·
            Recent all render inside NotesSurface's content area (contentView), so
            the three left-menu sections stay visible (the maintainer, 2026-06-26). Memory is
            no longer a front — the brain is browsed via the Vault tree (2026-06-28). */}
        {settingsOpen ? (
          <Suspense fallback={null}>
            <SettingsSurface />
          </Suspense>
        ) : (
          <NotesSurface />
        )}
      </main>
      <PreviewModal />
      <GuidedTour />
      {whichKey &&
        (hotkeyPeek === "badges" ? <HotkeyBadges /> : <WhichKey onClose={() => setWhichKey(false)} />)}
      <ContextMenu />
      <BoardNameDialog />
      <RenameDialog />
    </div>
  );
}

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const syntaxPalette = useUiStore((s) => s.syntaxPalette);
  const accentColor = useUiStore((s) => s.accentColor);
  const accentHue = useUiStore((s) => s.accentHue);
  const surface = surfaceFromUrl();

  useEffect(() => applyTheme(theme, themeFamily), [theme, themeFamily]);
  useEffect(() => applySyntaxPalette(syntaxPalette), [syntaxPalette]);
  useEffect(() => applyAccent(accentColor, accentHue), [accentColor, accentHue]);

  useAppearanceSync(surface);

  useEffect(() => {
    document.body.dataset.surface = surface;
  }, [surface]);

  // one dispatcher per webview, scoped to its surface
  useEffect(() => attachDispatcher(surface), [surface]);

  // rebinds made in the other webview land here too (one keymap, two webviews)
  useEffect(() => onRebind(({ actionId, chord }) => applyRebind(actionId, chord)), []);

  // the quick-access set is kept in step across webviews (the same pattern) —
  // the quick window emits its edits, the main window records + persists them
  useEffect(() => onQuickSet(applyQuickState), []);

  // a note born in the Quick Note window is filed into Main here — the quick
  // webview cannot write the manifest, and a full note must never sit in
  // Captures beside real captures (2026-09-01)
  useEffect(() => {
    if (surface !== "main") return;
    return onQuickCreated(({ id }) => fileQuickNoteInMain(id));
  }, [surface]);

  // A vault switch rebinds the live Rust default store. Keep all native windows
  // alive and replace only their vault-scoped caches/projections.
  useEffect(
    () =>
      onVaultChanged(() => {
        void refreshActiveVault();
      }),
    [],
  );

  useEffect(() => {
    if (surface !== "main") return;
    return onQuitFlushFailure((message) => {
      useUiStore
        .getState()
        .setRowActionError(`Rotli stayed open because some changes could not be saved — ${message}`);
    });
  }, [surface]);

  // apply the persisted Dock/app icon on startup (macOS; no-op elsewhere) —
  // main only: the quick/capture webviews would each repeat the same
  // main-thread NSApp icon call at boot for nothing
  useEffect(() => {
    if (isTauri() && surface === "main") void setAppIcon(useUiStore.getState().appIcon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (surface === "capture") return <CaptureCard />;
  if (surface === "quick") return <QuickNote />;
  return (
    <>
      <MainShell />
      <VaultFolderBrowser />
    </>
  );
}
