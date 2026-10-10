import "./styles/base.css";
import "./styles/app.css";
import "./styles/notes.css";
import "./styles/editor.css";
import "./styles/render.css";
import "./styles/command.css";
import "./styles/quick.css";
import "./styles/onboarding.css";
import "./styles/theme-orbs.css";
import "./styles/board.css";
import "./styles/memex.css";
import "./styles/breve.css";
import { Suspense, lazy, useEffect, useState } from "react";
// Excalidraw's vendor stylesheet (~144 KB raw / 23 KB gz) + canvas.css are no
// longer eager here — they load with the lazy board engine (boards/engine/
// excalidraw.tsx), so a session that never opens a board never pays for them at
// startup (perf audit 2026-08).

import { CaptureCard } from "./components/captureCard";
import { ContextMenu } from "./components/contextMenu";
import { FileNotice } from "./components/fileNotice";
import { useSetupFront } from "./components/onboarding/setupFlow";
import { GuidedTour } from "./components/tour/guidedTour";
import { SettingsHint } from "./components/tour/settingsHint";
import { HotkeyBadges } from "./components/hotkeyBadges";
import { NotesSurface } from "./components/notesSurface";
import { PreviewModal } from "./components/previewModal";
import { ChatShell } from "./components/chatWindow/chatShell";
import { QuickNote } from "./components/quickNote";
import { RenameDialog } from "./components/renameDialog";
import { BoardNameDialog } from "./components/boardNameDialog";
import { Titlebar } from "./components/titlebar";
import { WhichKey } from "./components/whichKey";
import { AppOpening } from "./components/onboarding/appOpening";
import { PinPanel } from "./components/pinnedSites/pinPanel";
import { WebVaultOverlays } from "./components/onboarding/webVaultOverlays";
import { WebChatSetupDialog } from "./components/webChatSetupDialog";
import { registerDefaultActions } from "./keys/actions";
import { replayHistoryKey } from "./keys/editHistoryActions";
import { type Surface, applyRebind, attachDispatcher, dispatch } from "./keys/registry";
import { hotkeyPeekDelay, useHeldModifier } from "./keys/useHeldModifier";
import {
  emitCaptureAck,
  hasDurableCorpus,
  isTauri,
  onBrainJournal,
  onCaptureSave,
  onCorpusChanged,
  onNativeCloseTab,
  onNativeEditHistory,
  onOpenRequest,
  onOrganizerProgress,
  onQuickCreated,
  onQuickSet,
  onRebind,
  onSummonChat,
  onSummonSearch,
  onVaultChanged,
  setAppIcon,
  setHideOnBlur,
  workspaceTakeOpenRequest,
} from "./lib/tauri";
import { attachAgentBridge } from "./ai/agentRequests";
import { useNativeFileDrop } from "./editor/nativeFileDrop";
import { LAUNCH_FEATURES, PLATFORM } from "./lib/featurePolicy";
import { setupShows } from "./lib/reviewMode";
import { fileQuickNoteInMain } from "./newItems/composition";
import { createVaultCapture } from "./services/captureRouting";
import { openNoteChatFromQuickNote, summonChat } from "./services/chatSummon";
import { DEST } from "./services/destinations";
import { invalidateFolders, invalidateJournal, invalidateNotes } from "./services/hooks";
import { adoptPendingAtOrganize } from "./services/librarianAutoAdopt";
import { notesService } from "./services/notes";
import { isWebVault } from "./lib/browserVault";
import { useMainWindowWork } from "./services/mainWindowWork";
import {
  WebVaultGateHost,
  useFreshFolderWelcome,
  useWebVaultGateShown,
} from "./components/onboarding/webVaultGateHost";
import { queryClient } from "./services/query";
import { attachChatWindow } from "./state/chatWindow";
import { addFragmentToMain, hydrateMain } from "./state/main";
import { useOrganizerLive } from "./state/organizerLive";
import { activeTabOf, leaves, usePanesStore } from "./state/panes";
import { invalidateMemex } from "./memex/useMemex";
import { switchVault } from "./memex/service";
import { invalidateChatFolders } from "./services/chatFolders";
import { refreshAfterExternalCorpusChange } from "./services/externalCorpusChange";
import { refreshActiveVault } from "./state/activeVault";
import { routeOpenRequest } from "./state/openRequest";
import { runAutoRetentionMaintenance } from "./state/persist";
import { applyQuickState } from "./state/quick";
import { applyImageOutline, useAppearanceLook } from "./state/appearanceLook";
import { useAppearanceSync } from "./state/appearanceSync";
import { applyAccent, applySyntaxPalette, applyTheme } from "./state/theme";
import { useUiStore } from "./state/ui";
import { hydrateViews } from "./state/views";

// Settings and Onboarding are full-surface fronts most sessions never (or
// once) open — split them off the entry chunk like paneTree's CanvasSurface
// (perf audit 2026-07-30, #18). Suspense falls back to nothing for a frame.
const SettingsSurface = lazy(() =>
  import("./components/settingsSurface").then((m) => ({
    default: m.SettingsSurface,
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
 *  Quick Note window; `?window=chat` = Chat pulled out into its own window. */
function surfaceFromUrl(): Surface {
  const param = new URLSearchParams(window.location.search).get("window");
  if (param === "capture") return "capture";
  if (param === "quick") return "quick";
  if (param === "chat" && PLATFORM !== "web") return "chat"; // a NATIVE window: nothing on the web
  return "main";
}

function MainShell() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const transientCount = useUiStore((s) => s.transients.length);
  const focusMode = useUiStore((s) => s.focusMode);
  const onboarded = useUiStore((s) => s.onboarded);
  const mainAutoRemoveDays = useUiStore((s) => s.mainAutoRemoveDays);
  const chatAutoArchiveDays = useUiStore((s) => s.chatAutoArchiveDays);
  // first run, or once after an update that requires it (1.8.0: state/onboarding.ts)
  const onboardingActive = setupShows(isTauri(), import.meta.env.DEV, window.location.search, onboarded);
  // first run's screens, or the vault screen when there is no vault (setupFlow.tsx)
  const setupScreen = useSetupFront(onboardingActive, isTauri());
  const inSetup = setupScreen !== null;
  const showWebVaultGate = useWebVaultGateShown();
  const setupFront = inSetup || showWebVaultGate;

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
    enabled: LAUNCH_FEATURES.hotkeys && hotkeyPeek !== "off" && !settingsOpen && !setupFront,
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
          return routeOpenRequest(request, {
            switchVault,
            refreshActiveVault,
            open: (item) => {
              useUiStore.getState().setContentView("panes");
              usePanesStore.getState().openSummary(item);
            },
            fail: (message) => useUiStore.getState().setRowActionError(message),
          });
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

  // Agents reach Word documents through this window (ai/agentRequests.ts).
  useEffect(() => (LAUNCH_FEATURES.agents ? attachAgentBridge() : undefined), []);

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

  useFreshFolderWelcome();

  // fs mode: the window opens on the freshest note. The in-memory seed decides
  // this synchronously at module init; the disk corpus answers async — fill
  // the pristine startup tab once, never replacing anything the user opened.
  // A NOTE: a newer board or canvas opened here as a broken note tab.
  useEffect(() => {
    if (!hasDurableCorpus()) return;
    void notesService.listNotes().then((notes) => {
      const freshest = notes.find((note) => (note.kind ?? "note") === "note");
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
    if (inSetup) void setHideOnBlur(false);
  }, [inSetup]);

  if (showWebVaultGate) return <WebVaultGateHost />;

  if (setupScreen) return setupScreen;

  return (
    <div className="app-window">
      {/* the app's opening, once per launch (onboarding/appOpening.tsx) */}
      <AppOpening />
      <PinPanel />
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
      <SettingsHint />
      <FileNotice />
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
  const outlineImages = useAppearanceLook((s) => s.outlineImages);
  const surface = surfaceFromUrl();

  useEffect(() => applyTheme(theme, themeFamily), [theme, themeFamily]);
  useEffect(() => applySyntaxPalette(syntaxPalette), [syntaxPalette]);
  useEffect(() => applyAccent(accentColor, accentHue), [accentColor, accentHue]);
  useEffect(() => applyImageOutline(outlineImages), [outlineImages]);

  useAppearanceSync(surface);

  useEffect(() => {
    document.body.dataset.surface = surface;
  }, [surface]);

  // one dispatcher per webview, scoped to its surface
  useEffect(() => attachDispatcher(surface), [surface]);
  // Edit → Undo / Redo from the menu bar, in whichever window has focus
  useEffect(() => onNativeEditHistory(replayHistoryKey), []);

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

  // Chat in its own window: main records, the chat window reports (state/chatWindow.ts)
  useEffect(() => attachChatWindow(addFragmentToMain, openNoteChatFromQuickNote), []);
  // A vault switch rebinds the live Rust default store. Keep all native windows
  // alive and replace only their vault-scoped caches/projections.
  useEffect(
    () =>
      onVaultChanged(() => {
        void refreshActiveVault();
      }),
    [],
  );

  useMainWindowWork(surface);

  // apply the persisted Dock/app icon on startup (macOS; no-op elsewhere) —
  // main only: the quick/capture webviews would each repeat the same
  // main-thread NSApp icon call at boot for nothing
  useEffect(() => {
    if (isTauri() && surface === "main") void setAppIcon(useUiStore.getState().appIcon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (surface === "capture") return <CaptureCard />;
  if (surface === "quick") return <QuickNote />;
  if (surface === "chat") return <ChatShell />;
  return (
    <>
      <MainShell />
      {isWebVault() && <WebVaultOverlays />}
      {isWebVault() && <WebChatSetupDialog />}
    </>
  );
}
