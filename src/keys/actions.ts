import {
  closeFocusedPaneWithDraftCleanup,
  closeFocusedTabWithDraftCleanup,
} from "../documents/draftComposition";
// Every user-invocable action registers here so ⌘K and Settings → Hotkeys can
// list and rebind all of it. One dispatcher per webview, no ad-hoc keydown
// listeners elsewhere. The dispatcher routes by surface; Settings lists
// only capabilities enabled in this build.
import { type BlockToggle, type HeadingLevel, type InlineMark, activeEditor } from "../editor/commands";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import {
  corpusFrontmatter,
  corpusSetPinned,
  hideMainWindow,
  hideQuickWindow,
  isTauri,
  openUrl,
  summon,
  toggleMainWindow,
  toggleQuickWindow,
} from "../lib/tauri";
import {
  createManagedItem,
  createManagedItemInTabOptimistically,
  requestManagedBoardCreation,
} from "../newItems/composition";
import { type NewItemKind, isNewItemAvailable } from "../newItems/model";
import { openChatForNote } from "../noteChat/composition";
import { summonChat } from "../services/chatSummon";
import { invalidateNotes, lifecycleError } from "../services/hooks";
import { archiveNoteWithImages, trashNoteWithImages } from "../services/noteLifecycle";
import { notesService } from "../services/notes";
import { trashSystemSelection } from "../services/systemTrash";
import { reconnectActiveVault } from "../state/activeVault";
import { navigate } from "../state/navHistory";
import { DEFAULT_NOTE_STYLE, useNoteStyleStore } from "../state/noteStyle";
import { activeTabOf, findLeaf, leaves, openNavTarget, usePanesStore } from "../state/panes";
import { cycleQuick, removeQuickNote } from "../state/quick";
import { toggleSettings } from "../state/settingsToggle";
import { startTour } from "../state/tour";
import { SIDEBAR_ZOOM_STEP, useUiStore } from "../state/ui";
import { EDITOR_ACTION } from "./editorActionIds";
import { captureHandle, quickHandle, setupHandle } from "./handles";
import { registerAction } from "./registry";
import { runSurfaceFind } from "./surfaceFind";

const notesWorkspaceActive = (): boolean => useUiStore.getState().sidebarMode !== "breve";

/** The focused pane's active tab noteId, read imperatively for action runs
 * (the hook form useFocusedNoteId is for components). null when the pane has no
 * resolvable tab (the maintainer, 2026-06-13: the lifecycle chords target this note). */
function focusedNoteIdNow(): string | null {
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId) ?? leaves(root)[0];
  if (!leaf) return null;
  const tab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];
  return tab && tab.surfaceKind === "note" ? tab.noteId : null;
}

function focusedTabNow() {
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId) ?? leaves(root)[0];
  return leaf ? activeTabOf(leaf) : null;
}

function runCreate(kind: NewItemKind, newTab: boolean): void {
  if (kind === "board") {
    requestManagedBoardCreation({ newTab });
    return;
  }
  void createManagedItem(kind, { newTab }).catch((error) =>
    useUiStore
      .getState()
      .setRowActionError(
        `Couldn’t create the item — ${error instanceof Error ? error.message : String(error)}`,
      ),
  );
}

/** ⌘T / the tab-strip plus is contextual only for the private browser, where
 * a sibling session is the familiar and privacy-preserving meaning of a new
 * tab. Every other surface keeps the persisted new-item default. */
export function newItemInTab(): void {
  if (focusedTabNow()?.surfaceKind === "browser") {
    usePanesStore.getState().openBrowser();
    return;
  }
  const kind = useUiStore.getState().newTabDefault;
  if (kind === "board") {
    requestManagedBoardCreation({ newTab: true });
    return;
  }
  createManagedItemInTabOptimistically(kind);
}

/** ⌘+/⌘− — CONTEXTUAL zoom (the maintainer, 2026-06-26: "zoom in and out but just where I
 * am"): with focus in the sidebar it scales the sidebar tree; otherwise it steps
 * the FOCUSED note's body text size (the per-note Aa render layer — persisted to
 * settings, never written into the .md). Other surfaces (chat/canvas/file) are
 * untouched for now. */
function zoomBy(delta: 1 | -1): void {
  if (document.activeElement?.closest(".sidebar")) {
    const ui = useUiStore.getState();
    ui.setSidebarZoom(ui.sidebarZoom + delta * SIDEBAR_ZOOM_STEP);
    return;
  }
  if (!notesWorkspaceActive()) return;
  const noteId = focusedNoteIdNow();
  if (!noteId) return;
  const styles = useNoteStyleStore.getState();
  const size = styles.styles[noteId]?.size ?? DEFAULT_NOTE_STYLE.size;
  styles.setSize(noteId, size + delta); // setSize clamps to the readable band
}

function zoomReset(): void {
  if (document.activeElement?.closest(".sidebar")) {
    useUiStore.getState().setSidebarZoom(1);
    return;
  }
  if (!notesWorkspaceActive()) return;
  const noteId = focusedNoteIdNow();
  if (noteId) useNoteStyleStore.getState().setSize(noteId, DEFAULT_NOTE_STYLE.size);
}

export function registerDefaultActions(): void {
  registerAction({
    id: "vault.refresh",
    title: "Refresh current vault",
    defaultChord: "Meta+R",
    enabled: () => isTauri(),
    run: () => {
      void reconnectActiveVault().catch((error: unknown) =>
        useUiStore
          .getState()
          .setRowActionError(
            `Couldn’t refresh the vault — ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    },
  });

  registerAction({
    id: "setup.continue",
    title: "Continue setup",
    defaultChord: "Meta+Enter",
    enabled: () => setupHandle() !== null,
    transient: true,
    run: () => setupHandle()?.continue(),
  });

  registerAction({
    id: "setup.back",
    title: "Back a setup step",
    // ⌘← during first-run: ⌘[ stays the app-wide nav.back, but the setup
    // footer advertises the arrow — no editor exists during setup, so the
    // caret's line-start chord cannot clash here.
    defaultChord: "Meta+ArrowLeft",
    enabled: () => setupHandle()?.back !== undefined,
    transient: true,
    run: () => setupHandle()?.back?.(),
  });

  registerAction({
    id: "app.hide",
    title: "Hide rotli",
    defaultChord: "Esc",
    run: () => {
      // Esc unwinds one layer at a time (quokka rule): topmost transient
      // (popovers, in stack order) → settings → a content view (board / all-notes
      // / chat) back to the note panes → memory → focus mode → the window itself.
      const ui = useUiStore.getState();
      if (ui.closeTopTransient()) return;
      if (ui.settingsOpen) {
        ui.setSettingsOpen(false);
        return;
      }
      if (ui.sidebarMode === "breve") {
        ui.setSidebarMode("notes");
        return;
      }
      if (ui.contentView !== "panes") {
        ui.setContentView("panes");
        return;
      }
      if (ui.focusMode) {
        ui.setFocusMode(false);
        return;
      }
      void hideMainWindow();
    },
  });

  // — the two summon surfaces (both global, separately rebindable).
  // the maintainer's law (2026-06-12): ⌥Space opens the APP; capture has its own chord. —
  registerAction({
    id: "app.toggleWindow",
    title: "Open or hide rotli",
    defaultChord: "Alt+Space",
    global: true,
    run: () => void toggleMainWindow(),
  });
  registerAction({
    id: "capture.summon",
    title: "Quick capture",
    defaultChord: "Alt+C",
    global: true, // lives in Rust; dispatch() works for review automation
    run: () => void summon(),
  });
  registerAction({
    id: "quick.summon",
    title: "Quick note",
    defaultChord: "Alt+Q",
    global: true, // the floating Quick Note window; toggle lives in Rust
    run: () => void toggleQuickWindow(),
  });

  // — the command layer —
  // Back / Forward over opened notes (the maintainer #14 — the recorder ran since 0.24.x;
  // this is the player: the titlebar ‹ › buttons + the browser chords). The
  // Meta+Bracket chords are FREE on the main surface (quick.next/prev own them
  // only inside the Quick window — chords scope per surface).
  registerAction({
    id: "nav.back",
    title: "Back — previous note",
    defaultChord: "Meta+BracketLeft",
    run: () => {
      const setup = setupHandle();
      if (setup?.back) {
        setup.back();
        return;
      }
      if (!notesWorkspaceActive()) return;
      navigate(-1, openNavTarget);
    },
  });
  registerAction({
    id: "nav.forward",
    title: "Forward — next note",
    defaultChord: "Meta+BracketRight",
    run: () => {
      if (!notesWorkspaceActive()) return;
      navigate(1, openNavTarget);
    },
  });
  registerAction({
    id: "palette.toggle",
    title: "Search notes & actions",
    defaultChord: "Meta+K",
    run: () => {
      const ui = useUiStore.getState();
      ui.setPaletteOpen(!ui.paletteOpen);
    },
  });
  registerAction({
    id: "view.focus",
    title: "Focus mode",
    defaultChord: "Alt+Meta+F",
    run: () => {
      const ui = useUiStore.getState();
      if (ui.sidebarMode === "breve") return;
      ui.setSettingsOpen(false);
      ui.setFocusMode(!ui.focusMode);
    },
  });
  if (LAUNCH_FEATURES.breve)
    registerAction({
      id: "view.breve",
      title: "Open or close Breve",
      defaultChord: "Meta+Shift+B", // Breve had no chord at all (audit 2026-09-02 §1.3)
      run: () => {
        const ui = useUiStore.getState();
        ui.setSettingsOpen(false);
        ui.setFocusMode(false);
        if (ui.sidebarMode === "breve") {
          ui.setSidebarMode("notes");
          if (useUiStore.getState().sidebarMode === "notes") ui.setContentView("panes");
        } else {
          ui.setSidebarMode("breve");
        }
      },
    });
  // Block handles — the Milkdown-style ⠿ drag/add/remove gutter (also an Aa toggle).
  registerAction({
    id: "editor.toggleBlocks",
    title: "Toggle block handles",
    defaultChord: null,
    run: () => {
      const ui = useUiStore.getState();
      ui.setBlockHandles(!ui.blockHandles);
    },
  });
  registerAction({
    id: "editor.toggleMetadata",
    title: "Toggle file metadata",
    defaultChord: "Meta+Shift+M",
    run: () => {
      if (!notesWorkspaceActive() || !focusedNoteIdNow()) return;
      const ui = useUiStore.getState();
      ui.setFileMetadata(ui.fileMetadata === "show" ? "hide" : "show");
    },
  });
  registerAction({ id: "app.tour", title: "Show me around", defaultChord: null, run: startTour });
  registerAction({
    id: "app.settings",
    title: "Settings",
    defaultChord: "Meta+Comma",
    run: () => toggleSettings(),
  });

  // The Board — quick captures collected as cards (the maintainer, 2026-06-19). A view in
  // the content area now (the sidebar stays); ⌘K-reachable + rebindable, opened
  // from the sidebar. Toggles between the board grid and the note panes.
  registerAction({
    id: "board.open",
    title: "Captures",
    defaultChord: null,
    run: () => {
      const ui = useUiStore.getState();
      ui.setFocusMode(false);
      ui.setSettingsOpen(false);
      ui.setSidebarMode("notes");
      ui.setSidebarView("home"); // Captures is a Home row
      ui.setContentView(ui.contentView === "board" ? "panes" : "board");
    },
  });

  registerAction({
    id: "theme.cycle",
    title: "Cycle theme",
    defaultChord: null,
    run: () => useUiStore.getState().cycleTheme(),
  });

  // — notes —
  // ⌘N is the blank NEW-TAB chooser now (the maintainer, 2026-07-29): "no type selected,
  // you have to choose". notes.new stays palette/menu-reachable, chord-free.
  registerAction({
    id: "notes.new",
    title: "New note",
    defaultChord: null,
    run: () => {
      if (useUiStore.getState().sidebarMode !== "breve") runCreate("markdown", false);
    },
  });
  registerAction({
    id: "tabs.newChooser",
    title: "New tab (choose type)",
    defaultChord: "Meta+N",
    run: () => {
      if (useUiStore.getState().sidebarMode !== "breve") usePanesStore.getState().openNewItemTab();
    },
  });
  for (const [id, title, kind] of [
    ["items.newMarkdown", "New Markdown note", "markdown"],
    ["items.newDocument", "New document", "document"],
    ["items.newSheet", "New sheet", "sheet"],
    ["items.newMermaid", "New Mermaid diagram", "mermaid"],
  ] as const) {
    if (!isNewItemAvailable(kind, LAUNCH_FEATURES)) continue;
    registerAction({
      id,
      title,
      defaultChord: null,
      run: () => {
        if (useUiStore.getState().sidebarMode !== "breve") runCreate(kind, true);
      },
    });
  }
  registerAction({
    id: "boards.new",
    title: "New Excalidraw board",
    // ⌘⇧T (the maintainer, 2026-07-29) — reopen-closed-tab moved to ⌘⌥T for it
    defaultChord: "Meta+Shift+T",
    run: () => {
      if (useUiStore.getState().sidebarMode === "breve") return;
      runCreate("board", true);
    },
  });

  // — note lifecycle (the maintainer, 2026-06-13): archive / trash / restore the FOCUSED
  //   note (the focused pane's active tab). All three reach ⌘K automatically and
  //   are rebindable. Trash is deliberately UNBOUND by default: ⌘⌫ would hijack
  //   the editor's delete-to-line-start AND get preventDefault-ed, so it ships
  //   chord-less but still palette-reachable. —
  registerAction({
    id: "notes.archive",
    title: "Archive note",
    defaultChord: "Meta+Shift+A",
    run: () => {
      if (!notesWorkspaceActive()) return;
      const id = focusedNoteIdNow();
      if (id) void archiveNoteWithImages(id).then(invalidateNotes).catch(lifecycleError("archive"));
    },
  });
  registerAction({
    id: "notes.trash",
    title: "Move note to Trash",
    defaultChord: null,
    run: () => {
      if (!notesWorkspaceActive()) return;
      const id = focusedNoteIdNow();
      if (id) void trashNoteWithImages(id).then(invalidateNotes).catch(lifecycleError("delete"));
    },
  });
  registerAction({
    id: "notes.restore",
    title: "Restore note",
    defaultChord: null,
    run: () => {
      if (!notesWorkspaceActive()) return;
      const id = focusedNoteIdNow();
      if (id) void notesService.restoreNote(id).then(invalidateNotes).catch(lifecycleError("restore"));
    },
  });
  // Pin / unpin the FOCUSED note (the maintainer, 2026-07-06: "a hotkey for pinning the
  // note I am already on"). Reads the note's current pin state, then flips the
  // typed `pinned` frontmatter fact — pinned notes float to the top of every
  // list. Never bumps `updated`, so a pin doesn't reorder by recency.
  registerAction({
    id: "notes.pin",
    title: "Pin / unpin note to top",
    defaultChord: "Meta+Shift+P",
    run: () => {
      if (!notesWorkspaceActive()) return;
      const id = focusedNoteIdNow();
      if (!id) return;
      void corpusFrontmatter(id).then((fm) => corpusSetPinned(id, !fm?.pinned).then(invalidateNotes));
    },
  });

  // — tabs (created only by explicit gestures; plain click replaces). ⌘T uses
  //   the configured item default in the workspace and a fresh private sibling
  //   in the browser — never a duplicate of the current content. —
  registerAction({
    id: "tabs.new",
    title: "New tab",
    defaultChord: "Meta+T",
    run: () => {
      if (useUiStore.getState().sidebarMode !== "breve") newItemInTab();
    },
  });
  registerAction({
    id: "tabs.close",
    title: "Close tab",
    defaultChord: "Meta+W",
    run: () => {
      if (notesWorkspaceActive()) closeFocusedTabWithDraftCleanup();
    },
  });
  registerAction({
    id: "tabs.cycle",
    title: "Next tab",
    defaultChord: "Ctrl+Tab",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().cycleTab();
    },
  });
  registerAction({
    id: "tabs.cyclePrev",
    title: "Previous tab",
    defaultChord: "Ctrl+Shift+Tab",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().cycleTab(-1);
    },
  });
  registerAction({
    id: "tabs.reopen",
    title: "Reopen closed tab",
    // ⌘⌥T — ⌘⇧T became New board (the maintainer, 2026-07-29); rebindable as ever
    defaultChord: "Meta+Alt+T",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().reopenClosedTab();
    },
  });
  registerAction({
    id: "system.trashSelection",
    title: "Move selection to Trash",
    defaultChord: "Meta+Backspace",
    run: () => {
      const ui = useUiStore.getState();
      if (ui.contentView !== "system" || ui.systemSelection.length === 0) return;
      void trashSystemSelection();
    },
  });
  for (let n = 1; n <= 8; n++) {
    registerAction({
      id: `tabs.jump${n}`,
      title: `Go to tab ${n}`,
      defaultChord: `Meta+${n}`,
      run: () => {
        if (notesWorkspaceActive()) usePanesStore.getState().jumpTab(n - 1);
      },
    });
  }
  registerAction({
    id: "tabs.last",
    title: "Go to last tab",
    defaultChord: "Meta+9",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().lastTab();
    },
  });

  // — panes —
  registerAction({
    id: "panes.splitRight",
    title: "Split right",
    defaultChord: "Meta+D",
    run: () => {
      if (useUiStore.getState().sidebarMode !== "breve") usePanesStore.getState().splitRight();
    },
  });
  registerAction({
    id: "panes.splitDown",
    title: "Split down",
    defaultChord: "Meta+Shift+D",
    run: () => {
      if (useUiStore.getState().sidebarMode !== "breve") usePanesStore.getState().splitDown();
    },
  });
  registerAction({
    id: "panes.focusLeft",
    title: "Focus pane left",
    defaultChord: "Meta+Alt+ArrowLeft",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().focusDir("left");
    },
  });
  registerAction({
    id: "panes.focusRight",
    title: "Focus pane right",
    defaultChord: "Meta+Alt+ArrowRight",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().focusDir("right");
    },
  });
  registerAction({
    id: "panes.focusUp",
    title: "Focus pane up",
    defaultChord: "Meta+Alt+ArrowUp",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().focusDir("up");
    },
  });
  registerAction({
    id: "panes.focusDown",
    title: "Focus pane down",
    defaultChord: "Meta+Alt+ArrowDown",
    run: () => {
      if (notesWorkspaceActive()) usePanesStore.getState().focusDir("down");
    },
  });
  registerAction({
    id: "panes.close",
    title: "Close pane",
    defaultChord: "Meta+Alt+W",
    run: () => {
      if (notesWorkspaceActive()) closeFocusedPaneWithDraftCleanup();
    },
  });

  // — chrome —
  // ONE sidebar toggle (the maintainer, 2026-06-13: folders + note-list collapsed into a
  // single navigator; chrome.toggleList ⌥⌘L retired). ⌘0 keeps its muscle
  // memory; the inline .sidebtn and the warm-edge restore strip dispatch this
  // same action — one row in Settings, not two.
  registerAction({
    id: "chrome.toggleSidebars",
    title: "Toggle sidebar",
    defaultChord: "Meta+0",
    run: () => useUiStore.getState().toggleSidebar(),
  });

  // — contextual zoom (the maintainer, 2026-06-26): ⌘+/⌘− act where the focus is — the
  // sidebar tree, or the focused note's text size. Reset is palette-reachable.
  registerAction({
    id: "view.zoomIn",
    title: "Zoom in — sidebar or note",
    defaultChord: "Meta+Equal",
    run: () => zoomBy(1),
  });
  registerAction({
    id: "view.zoomOut",
    title: "Zoom out — sidebar or note",
    defaultChord: "Meta+Minus",
    run: () => zoomBy(-1),
  });
  registerAction({
    id: "view.zoomReset",
    title: "Reset zoom",
    defaultChord: null,
    run: () => zoomReset(),
  });

  // — editor formatting (the r5 format bar's 11 controls + highlight; chords
  //   from the r3 gate footer, the rest unbound-but-rebindable) —
  const marks: [string, string, InlineMark, string | null][] = [
    [EDITOR_ACTION.bold, "Bold", "bold", "Meta+B"],
    [EDITOR_ACTION.italic, "Italic", "italic", "Meta+I"],
    [EDITOR_ACTION.underline, "Underline", "underline", "Meta+U"],
    [EDITOR_ACTION.strike, "Strikethrough", "strike", null],
    [EDITOR_ACTION.code, "Inline code", "code", null],
    [EDITOR_ACTION.highlight, "Highlight", "highlight", "Meta+Shift+H"],
    [EDITOR_ACTION.link, "Link", "link", null],
  ];
  for (const [id, title, mark, defaultChord] of marks) {
    // shared: the format chords act on activeEditor(), which resolves per
    // webview — so they belong to the main AND the Quick Note window
    registerAction({
      id,
      title,
      defaultChord,
      shared: true,
      run: () => {
        if (notesWorkspaceActive()) activeEditor()?.toggleMark(mark);
      },
    });
  }
  registerAction({
    id: "editor.find",
    title: "Find in this file",
    defaultChord: "Meta+F",
    shared: true,
    run: () => {
      if (!notesWorkspaceActive()) return;
      const editor = activeEditor();
      if (editor?.find) editor.find();
      else runSurfaceFind();
    },
  });
  for (const level of [1, 2, 3] as HeadingLevel[]) {
    registerAction({
      id: `editor.heading${level}`,
      title: `Heading ${level}`,
      defaultChord: null,
      shared: true,
      run: () => {
        if (notesWorkspaceActive()) activeEditor()?.setHeading(level);
      },
    });
  }
  const blocks: [string, string, BlockToggle][] = [
    [EDITOR_ACTION.quote, "Quote", "quote"],
    [EDITOR_ACTION.bulletList, "Bulleted list", "bullet"],
    [EDITOR_ACTION.numberedList, "Numbered list", "numbered"],
    [EDITOR_ACTION.checklist, "Checklist", "checklist"],
  ];
  for (const [id, title, kind] of blocks) {
    registerAction({
      id,
      title,
      defaultChord: null,
      shared: true,
      run: () => {
        if (notesWorkspaceActive()) activeEditor()?.toggleBlock(kind);
      },
    });
  }

  // Fold the section the caret is in (2026-08-04). ⌥⌘F is Focus mode, so
  // folding takes ⌥⌘K; rebindable like everything else.
  registerAction({
    id: "editor.foldHeading",
    title: "Fold or unfold this section",
    defaultChord: "Meta+Alt+K",
    shared: true,
    run: () => {
      if (notesWorkspaceActive()) activeEditor()?.toggleFold?.();
    },
  });

  // — the FRONTS (the maintainer's IA, 2026-08-01): ⌃⌘1 Home, ⌃⌘2 Chat. The sidebar's
  //   switcher and these chords are the same gesture, and including ⌘ means the
  //   chord shown by the held-Command overlay can be pressed directly without
  //   releasing the reveal key first (review 2026-08-08). —
  registerAction({
    id: "modules.notes",
    title: "Go to Home",
    defaultChord: "Meta+Ctrl+1",
    run: () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(false);
      ui.setSidebarMode("notes");
      ui.setSidebarView("home");
      ui.setContentView("panes"); // back to the note panes
    },
  });
  registerAction({
    id: "modules.chat",
    title: "Go to Chat",
    defaultChord: "Meta+Ctrl+2",
    run: () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(false);
      ui.setSidebarMode("notes");
      ui.setSidebarView("chat");
    },
  });

  // …and ONE key to flip between them (the maintainer, 2026-08-04: "toggle through the
  // home and chat with hotkeys"). ⌃1/⌃2 stay the direct jumps; this is the
  // no-look switch for when you just want the other front.
  registerAction({
    id: "modules.toggleFront",
    title: "Switch sidebar front (Home ↔ Chat)",
    defaultChord: "Ctrl+Backquote",
    run: () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(false);
      ui.setSidebarMode("notes");
      const next = ui.sidebarView === "chat" ? "home" : "chat";
      ui.setSidebarView(next);
      // Home means the note panes; Chat leaves the content view alone (its own
      // rows drive it), mirroring modules.notes / modules.chat exactly.
      if (next === "home") ui.setContentView("panes");
    },
  });

  // Chat is a FRONT now, not a section. ⌃⌘⇧2 opens a fresh chat pane (it moved
  // off ⌃⌘2 so the two fronts could own ⌃⌘1/⌃⌘2 — bindings persist by action
  // id, so an existing override is untouched). Both reach ⌘K and are rebindable.
  registerAction({
    id: "chat.new",
    title: "New chat",
    defaultChord: "Meta+Ctrl+Shift+2",
    run: () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(false);
      ui.setSidebarMode("notes");
      ui.setSidebarView("chat");
      // chat is a PANE surface now — open a fresh chat pane. The old contentView
      // "chat" was retired and rendered nothing (the maintainer, 2026-06-30 — audit).
      usePanesStore.getState().openChat(null);
    },
  });
  registerAction({
    id: "chat.summon",
    title: "Summon chat",
    defaultChord: "Alt+A", // "ask" — the ⌥-letter global family (⌥Space/⌥C/⌥Q)
    global: true, // the OS chord lives in Rust (show_main + rotli:summon-chat);
    // run() keeps palette/dispatch parity for in-app invocation
    run: () => void summonChat(),
  });
  registerAction({
    id: "palette.summon",
    title: "Summon search",
    defaultChord: "Alt+F", // "find" — the ⌥-letter global family's search twin
    global: true, // Rust shows the window + emits rotli:summon-search;
    // in-app it force-OPENS the palette (never toggles — same law as ⌥A)
    run: () => useUiStore.getState().setPaletteOpen(true),
  });
  registerAction({
    id: "browser.open",
    title: "Open web browser",
    defaultChord: "Alt+T",
    run: () => void openUrl("https://www.google.com/"),
  });
  // — note ↔ chat: a note owns MANY chats (the maintainer, 2026-07-30). ⌘⇧C continues
  //   the most recently touched one (creating the first when none exists);
  //   the New variant always adds another. The editor's chat chip is the
  //   full picker; these are its fast paths. —
  const runNoteChat = (create: boolean) => {
    if (!notesWorkspaceActive()) return;
    const id = focusedNoteIdNow();
    if (!id) return;
    void notesService
      .listNotes()
      .then((all) => {
        const note = all.find((n) => n.id === id);
        if (note) return openChatForNote(note, { create });
      })
      .catch((error) =>
        useUiStore
          .getState()
          .setRowActionError(
            `Couldn’t open a chat — ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
  };
  registerAction({
    id: "note.chat",
    title: "Chat with this note",
    defaultChord: "Meta+Shift+C",
    run: () => runNoteChat(false),
  });
  registerAction({
    id: "note.chatNew",
    title: "New chat about this note",
    defaultChord: null,
    run: () => runNoteChat(true),
  });
  registerAction({
    id: "chat.all",
    title: "All chats",
    defaultChord: null,
    run: () => {
      const ui = useUiStore.getState();
      ui.setSettingsOpen(false);
      ui.setSidebarMode("notes");
      ui.setSidebarView("chat");
      // open the All-chats content view (the Chat-front twin of All notes)
      ui.setContentView("allChats");
    },
  });

  // — the capture card's own keys (surface: capture — its webview's dispatcher
  //   routes these; the textarea never grows ad-hoc listeners) —
  registerAction({
    id: "capture.save",
    title: "Capture — save",
    defaultChord: "Enter",
    surface: "capture",
    run: () => captureHandle()?.save(false),
  });
  registerAction({
    id: "capture.saveAndOpen",
    title: "Capture — save & open",
    defaultChord: "Meta+Enter",
    surface: "capture",
    run: () => captureHandle()?.save(true),
  });
  registerAction({
    id: "capture.dismiss",
    title: "Capture — dismiss",
    defaultChord: "Esc",
    surface: "capture",
    run: () => captureHandle()?.dismiss(),
  });

  // — the Quick Note window's own keys (surface: quick). new/search reach the
  //   mounted component through quickHandle; cycle/remove act on the set store;
  //   dismiss unwinds a transient (the search overlay) before hiding the window. —
  registerAction({
    id: "quick.new",
    title: "Quick note — new",
    defaultChord: "Meta+N",
    surface: "quick",
    run: () => quickHandle()?.newNote(),
  });
  registerAction({
    id: "quick.search",
    title: "Quick note — switch / pin notes",
    defaultChord: "Meta+P",
    surface: "quick",
    run: () => quickHandle()?.openSearch(),
  });
  registerAction({
    id: "quick.next",
    title: "Quick note — next",
    defaultChord: "Meta+BracketRight",
    surface: "quick",
    run: () => cycleQuick(1),
  });
  registerAction({
    id: "quick.prev",
    title: "Quick note — previous",
    defaultChord: "Meta+BracketLeft",
    surface: "quick",
    run: () => cycleQuick(-1),
  });
  registerAction({
    id: "quick.remove",
    title: "Quick note — remove from set",
    defaultChord: null,
    surface: "quick",
    run: () => {
      const id = useUiStore.getState().quickActiveId;
      if (id) removeQuickNote(id);
    },
  });
  registerAction({
    id: "quick.dismiss",
    title: "Quick note — dismiss",
    defaultChord: "Esc",
    surface: "quick",
    run: () => {
      // unwind a transient (the search overlay / a popover) before the window
      if (useUiStore.getState().closeTopTransient()) return;
      void hideQuickWindow();
    },
  });
}
