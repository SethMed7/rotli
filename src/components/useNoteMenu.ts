// useNoteMenu — one hook that builds the row menu for a note/file/board row and
// opens the context-menu store. Centralizes the item list + every handler so
// any surface (sidebar, All-notes, Recent, Main) wires it the same way:
// `const openMenu = useNoteMenu(); ... onContextMenu={(e) => openMenu(e, note)}`.
// The sidebar's "m" key opens the SAME menu with a synthetic anchor + a
// returnFocus that hands the cursor back to the row (the RowMenu unification).

import { useCallback } from "react";

import { discardBlankNote } from "../documents/draftComposition";
import { fileNameStem } from "../lib/fileKind";
import { noteDiskFolder } from "../lib/noteLocation";
import {
  corpusFileStat,
  corpusFrontmatter,
  corpusMoveFileToSink,
  corpusNoteAbsolutePath,
  corpusRevealFile,
  corpusSetLocalAiAccess,
  corpusSetLocked,
  corpusSetPinned,
  corpusSetSecure,
  isTauri,
} from "../lib/tauri";
import { openChatForNote } from "../noteChat/composition";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import { createRoutedNote } from "../services/createNote";
import { DEST, isSink } from "../services/destinations";
import { invalidateNotes, useArchiveNote, useRestoreNote, useTrashNote } from "../services/hooks";
import { useMainGcIds } from "../services/hooks";
import {
  activeItemSinkLane,
  fileLifecycleRows,
  readFileLifecycle,
  restoreSinkItem,
} from "../services/itemLifecycle";
import { renameLane } from "../services/itemRename";
import { isEmptyNote } from "../services/mainDismiss";
import { addNoteToMain, mainHasNote, removeFromMain } from "../services/mainTree";
import { markNoteDraftChanged } from "../services/noteDrafts";
import { notesService } from "../services/notes";
import { assignItemToView, assignedView, projectionMenuAction } from "../services/viewTree";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useMainStore } from "../state/main";
import { usePanesStore } from "../state/panes";
import { QUICK_MAX, togglePinQuick } from "../state/quick";
import { useUiStore } from "../state/ui";
import { useViewsStore } from "../state/views";
import type { NoteSummary } from "../types";
import { addToFolderMenu } from "./sidebar/addToFolderMenu";

/** What the opener hands us — a real MouseEvent qualifies, and a keyboard
 * opener passes a plain {clientX, clientY} built from its row's rect. */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export interface NoteMenuOptions {
  returnFocus?: () => void;
  /** Finder-style gathered Main rows. The right-clicked row must belong to
   * this set; otherwise the menu remains a single-item menu. */
  selectedItems?: readonly NoteSummary[];
  trashSelection?: (items: readonly NoteSummary[]) => void;
}

/** A duplicate's body: the title line gains " copy". The title is the first
 * non-blank line AFTER any leading `---` fence block (Greptile, PR #1: naming
 * the fence itself "--- copy" corrupted YAML frontmatter) — and a line that
 * is itself a `---` rule is never renamed. */
export function copyBody(body: string): string {
  const lines = body.split("\n");
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, at) => at > 0 && l.trim() === "---");
    if (close > 0) start = close + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trim() === "---") continue;
    lines[i] = `${line} copy`;
    return lines.join("\n");
  }
  return body;
}

async function copyFilePath(id: string): Promise<void> {
  try {
    const path = await corpusNoteAbsolutePath(id);
    if (!navigator.clipboard) throw new Error("the clipboard is unavailable");
    await navigator.clipboard.writeText(path);
  } catch (err) {
    useUiStore
      .getState()
      .setRowActionError(`Couldn’t copy the file path — ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function useNoteMenu() {
  const open = useContextMenu((s) => s.open);
  const openSummary = usePanesStore((s) => s.openSummary);
  const quickIds = useUiStore((s) => s.quickNoteIds);
  const setRenameTarget = useUiStore((s) => s.setRenameTarget);
  const manifest = useMainStore((s) => s.manifest);
  const setTree = useMainStore((s) => s.setTree);
  const viewsManifest = useViewsStore((s) => s.manifest);
  const setViewsManifest = useViewsStore((s) => s.setManifest);
  const activeView = useUiStore((s) => s.activeView);
  // GC liveIds MUST be the FULL note index (staged/archived/trashed included):
  // setTree prunes any Main ref not in this set, so building it from useNotes()
  // alone made "Add to Main" on a STAGED note a silent no-op — the add and the
  // GC of it happened in the same call. undefined until every listing loaded
  // (a still-loading or errored vault must not read as "gone" — skip the GC).
  const liveIds = useMainGcIds();
  const archive = useArchiveNote();
  const trash = useTrashNote();
  const restore = useRestoreNote();
  return useCallback(
    (e: MenuAnchor, note: NoteSummary, opts?: NoteMenuOptions) => {
      // preventDefault MUST be synchronous (suppress the native menu before any
      // await), then the async build fetches lock/secure state before opening.
      e.preventDefault?.();
      e.stopPropagation?.();
      const x = e.clientX;
      const y = e.clientY;
      const selectedItems =
        opts?.trashSelection &&
        opts.selectedItems &&
        opts.selectedItems.length > 1 &&
        opts.selectedItems.some((item) => item.id === note.id)
          ? [...new Map(opts.selectedItems.map((item) => [item.id, item])).values()]
          : null;

      void (async () => {
        // Boards restore like FILES, not like notes (2026-08-04): a board is
        // addressed by its path and carries no frontmatter, so it has no origin
        // breadcrumb for the note lane to read — the sink-relative restore is
        // its only correct way home. Trashing one is now possible (the note
        // lane used to refuse it outright), so its return trip must work too.
        const isFile = note.kind === "file";
        const isBoard = note.kind === "board";
        const restoresByPath = isFile || isBoard;
        // an archived/trashed note: open + Restore only — the lifecycle actions
        // don't apply until it's back (mirrors the retired RowMenu's split).
        // Gate on isSink (Archive/Trash), NOT isHidden: a STAGED capture lives
        // in Board (isHidden) yet is a live note that shows in All notes — it
        // must get the full menu, not a dead "Restore" that no-ops (the maintainer,
        // 2026-07-06: "Restore does nothing but I can see it in All notes").
        if (isSink(note.folderId)) {
          const restoreItem: MenuSpec = {
            kind: "action" as const,
            label: restoresByPath ? "Restore to original folder" : "Restore",
            onClick: () => {
              useUiStore.getState().setRowActionError(null);
              void restoreSinkItem(note, restore.mutateAsync).catch((err) =>
                useUiStore
                  .getState()
                  .setRowActionError(
                    `Couldn’t restore “${note.title || "this file"}” — ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  ),
              );
            },
          };
          open(
            x,
            y,
            [
              {
                kind: "action" as const,
                label: "Open in new tab",
                onClick: () => openSummary(note, { newTab: true }),
              },
              {
                kind: "action" as const,
                label: "Show in Finder",
                disabled: !isTauri(),
                onClick: () => void corpusRevealFile(note.id),
              },
              {
                kind: "action" as const,
                label: "Copy File Path",
                disabled: !isTauri(),
                onClick: () => {
                  useUiStore.getState().setRowActionError(null);
                  void copyFilePath(note.id);
                },
              },
              { kind: "sep" as const },
              restoreItem,
            ],
            opts,
          );
          return;
        }

        const isNote = !isFile && !isBoard;
        const sinkLane = activeItemSinkLane(note.kind);
        const inMain = mainHasNote(manifest.tree, note.id);
        const currentView = assignedView(viewsManifest, note.id);
        const starred = quickIds.includes(note.id);
        const full = !starred && quickIds.length >= QUICK_MAX;
        // lock/secure aren't on NoteSummary — read them from frontmatter so the
        // menu shows the right toggle label + check (the maintainer #23, 2026-07-03: these
        // moved out of the metadata popover into this menu).
        const fm = isNote ? await corpusFrontmatter(note.id).catch(() => null) : null;
        const fileLifecycle =
          sinkLane === "file" ? await readFileLifecycle(() => corpusFileStat(note.id)) : null;
        const secureAtHome =
          isNote && (isSecureBrainFolder(noteDiskFolder(note)) || isSecureNotesFolder(noteDiskFolder(note)));

        // frontmatter toggles surface failures in the sidebar's inline error
        // note (the menu is gone by the time a write fails — #11 pattern)
        const runFm = (verb: string, op: Promise<unknown>) => {
          useUiStore.getState().setRowActionError(null);
          // an explicit lock/secure/fm mutation = intent to keep the note —
          // it must never be discarded as an abandoned blank draft
          markNoteDraftChanged(note.id);
          void op
            .then(invalidateNotes)
            .catch((err) =>
              useUiStore
                .getState()
                .setRowActionError(`Couldn't ${verb} — ${err instanceof Error ? err.message : String(err)}`),
            );
        };

        const items: MenuSpec[] = [];
        // Quick Look (the maintainer, 2026-07-29): peek without opening fully — Space in
        // the System browser opens the same modal
        items.push({
          kind: "action" as const,
          label: "Preview",
          onClick: () => useUiStore.getState().setPreviewItem(note),
        });
        items.push({
          kind: "action" as const,
          label: "Open in new tab",
          onClick: () => openSummary(note, { newTab: true }),
        });
        items.push({
          kind: "action" as const,
          label: "Open to the right",
          onClick: () =>
            usePanesStore.getState().openToSide(isBoard ? "canvas" : isFile ? "file" : "note", note.id),
        });
        if (isNote) {
          // a note owns MANY chats (2026-07-30): the first verb continues the
          // most recent one (or starts the first); the second always adds one.
          // The editor's chat chip is the full picker.
          const chatError = (err: unknown) =>
            useUiStore
              .getState()
              .setRowActionError(
                `Couldn’t open a chat for “${note.title || "this note"}” — ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
          items.push({
            kind: "action" as const,
            label: "Chat with this note",
            onClick: () => {
              useUiStore.getState().setRowActionError(null);
              void openChatForNote(note).catch(chatError);
            },
          });
          items.push({
            kind: "action" as const,
            label: "New chat about this note",
            onClick: () => {
              useUiStore.getState().setRowActionError(null);
              void openChatForNote(note, { create: true }).catch(chatError);
            },
          });
        }
        items.push({
          kind: "action" as const,
          label: "Show in Library",
          onClick: () => {
            // One file, two views: Main is a shortcut over the Brain. Always
            // open the note first so focus settles for the reveal.
            openSummary(note);
            const ui = useUiStore.getState();
            ui.setFocusMode(false);
            ui.setSettingsOpen(false);
            const diskFolder = noteDiskFolder(note);
            const staged =
              diskFolder === "wiki/_inbox" ||
              diskFolder.startsWith("wiki/_inbox/") ||
              (diskFolder === note.folderId && note.folderId === DEST.board);
            if (staged) {
              // Staging home = Captures (wiki/_inbox → Board). Curated notes
              // (also in Main / starred) are filtered OFF the Captures grid —
              // reveal their Main/sidebar row instead. Uncurated ones open
              // Captures and highlight the card. FORCE the view open —
              // board.open toggles, so a second click used to bounce back to
              // panes and look like a no-op (the maintainer, 2026-07-09).
              const curated =
                mainHasNote(useMainStore.getState().manifest.tree, note.id) ||
                ui.quickNoteIds.includes(note.id);
              if (curated) {
                ui.setContentView("panes");
                setTimeout(() => ui.revealFocusedNote("auto", note.id), 0);
              } else {
                ui.setContentView("board");
                // BoardSurface highlights the focused note's card; a tick lets
                // openNote settle focus before the scroll.
                setTimeout(() => ui.revealFocusedNote("auto", note.id), 0);
              }
              return;
            }
            // Filed note: its shelf may still project to Captures or another
            // user folder, but diskFolder preserves the real wiki chain.
            ui.setContentView("panes");
            setTimeout(() => ui.revealFocusedNote("brain", note.id), 0);
          },
        });
        items.push({
          kind: "action" as const,
          label: "Show in Finder",
          disabled: !isTauri(),
          onClick: () => {
            // failures surfaced in the sidebar's inline error note — this
            // silently no-op'd for months while the Rust side threw (the maintainer #63)
            useUiStore.getState().setRowActionError(null);
            void corpusRevealFile(note.id).catch((err) =>
              useUiStore
                .getState()
                .setRowActionError(
                  `Couldn't reveal in Finder — ${err instanceof Error ? err.message : String(err)}`,
                ),
            );
          },
        });
        items.push({
          kind: "action" as const,
          label: "Copy File Path",
          disabled: !isTauri(),
          onClick: () => {
            useUiStore.getState().setRowActionError(null);
            void copyFilePath(note.id);
          },
        });
        items.push({ kind: "sep" as const });
        // "Move to…" retired (the maintainer, 2026-07-28: it listed Library areas no
        // matter which view you were in — misleading; the System browser and
        // the Librarian own placement). Duplicate replaces it as the quick
        // by-hand verb: a full copy, "title copy". Placement goes through the
        // ONE creation router — a plain folder duplicates in place, a curated
        // memex folder routes to Brain staging BY DECISION, and any real
        // failure surfaces instead of silently mislanding the copy (Greptile,
        // PR #1: the old blanket catch hid deleted-folder/permission errors).
        if (!isBoard && !isFile) {
          items.push({
            kind: "action" as const,
            label: "Duplicate",
            onClick: () => {
              useUiStore.getState().setRowActionError(null);
              void (async () => {
                const src = await notesService.getNote(note.id);
                if (!src) throw new Error("the note could not be read");
                const home = noteDiskFolder(note);
                const dupId = await createRoutedNote({
                  selectedFolderId: home,
                  isSmart: false,
                  localFallback: home,
                  body: copyBody(src.body),
                  // a duplicated capture is still a capture
                  ...(note.folderId === DEST.board ? { shelf: ["Inbox"] } : {}),
                });
                await invalidateNotes();
                usePanesStore.getState().openNote(dupId);
              })().catch((err: unknown) =>
                useUiStore
                  .getState()
                  .setRowActionError(
                    `Couldn’t duplicate the note — ${err instanceof Error ? err.message : String(err)}`,
                  ),
              );
            },
          });
        }
        if (viewsManifest.views.length > 0) {
          items.push({
            kind: "drill" as const,
            label: "Move to view",
            items: [
              {
                kind: "action" as const,
                label: "Main only",
                checked: currentView === null,
                checkedMark: "highlight" as const,
                onClick: () => setViewsManifest(assignItemToView(viewsManifest, note.id, null)),
              },
              ...viewsManifest.views.map((view) => ({
                kind: "action" as const,
                label: view.name,
                checked: currentView === view.name,
                checkedMark: "highlight" as const,
                onClick: () => {
                  setTree(addNoteToMain(manifest.tree, note.id), liveIds);
                  setViewsManifest(assignItemToView(viewsManifest, note.id, view.name));
                },
              })),
            ],
          });
        }
        if (!isBoard) {
          items.push({
            kind: "action" as const,
            label: starred ? "Unstar — remove from Quick access" : "Star for Quick access",
            checked: starred,
            disabled: full,
            onClick: () => togglePinQuick(note.id),
          });
        }
        if (activeView === null) {
          const filing = addToFolderMenu({
            tree: manifest.tree,
            note,
            selection: opts?.selectedItems,
            setTree: (tree) => setTree(tree, liveIds),
            requestRename: (folderId) => useUiStore.getState().setMainRenameRequest(folderId),
          });
          if (filing) items.push(filing);
        }
        const projectionAction = projectionMenuAction(activeView, currentView, inMain);
        items.push({
          kind: "action" as const,
          label: projectionAction.label,
          onClick: () => {
            if (projectionAction.kind === "remove-view") {
              setViewsManifest(assignItemToView(viewsManifest, note.id, null));
            } else if (projectionAction.kind === "remove-main") {
              setTree(removeFromMain(manifest.tree, note.id), liveIds);
              if (currentView) {
                setViewsManifest(assignItemToView(viewsManifest, note.id, null));
              }
              // an empty note dismissed from Main shouldn't linger in the corpus
              // (the maintainer, 2026-07-07) — hard-discard, never into the Trash folder
              // (2026-07-17: Rust re-verifies blankness and refuses otherwise)
              void isEmptyNote(note.id).then((empty) => {
                if (empty) void discardBlankNote(note.id);
              });
            } else {
              setTree(addNoteToMain(manifest.tree, note.id), liveIds);
            }
          },
        });
        if (isNote) {
          items.push({
            kind: "action" as const,
            label: fm?.pinned ? "Unpin from top" : "Pin to top",
            checked: !!fm?.pinned,
            onClick: () => runFm("pin", corpusSetPinned(note.id, !fm?.pinned)),
          });
          items.push({
            kind: "action" as const,
            // LOCKED is an EDIT control — every model still READS a locked note
            // (the maintainer, 2026-08-01; docs/design/ai-visibility-matrix.md)
            label: fm?.locked ? "Unlock — let the AI edit it" : "Lock — no AI may edit it",
            checked: !!fm?.locked,
            // protection states wear the LOCK, not the star (the maintainer, 2026-07-29)
            checkedMark: "lock" as const,
            onClick: () => runFm("lock", corpusSetLocked(note.id, !fm?.locked)),
          });
          items.push({
            kind: "action" as const,
            label: fm?.secure ? "Remove secure protection" : "Mark secure — block remote AI",
            checked: !!fm?.secure,
            checkedMark: "lock" as const,
            onClick: () => runFm("mark secure", corpusSetSecure(note.id, !fm?.secure)),
          });
          if (fm?.secure && !secureAtHome) {
            items.push({
              kind: "action" as const,
              label: "Move into Library › Secure notes",
              onClick: () => runFm("move to Secure notes", corpusSetSecure(note.id, true)),
            });
          }
          if (fm?.secure) {
            // `localAiAllowed` is the EFFECTIVE verdict Rust resolved (note
            // override → the vault knob → allow). On-device access is the
            // default since 2026-08-01, so the common verb here is now HIDE.
            items.push({
              kind: "action" as const,
              label: fm.localAiAllowed ? "Hide from on-device AI too" : "Let on-device AI read it",
              checked: fm.localAiAllowed,
              onClick: () =>
                runFm("change Local AI access", corpusSetLocalAiAccess(note.id, !fm.localAiAllowed)),
            });
          }
        }
        const renameVia = renameLane(note);
        if (renameVia) {
          items.push({ kind: "sep" as const });
          items.push({
            kind: "action" as const,
            label: "Rename…",
            onClick: () =>
              renameVia === "title"
                ? setRenameTarget({ id: note.id, current: note.title })
                : setRenameTarget({ id: note.id, current: fileNameStem(note.id), lane: renameVia }),
          });
        }
        items.push({ kind: "sep" as const });
        if (sinkLane === "note") {
          items.push({
            kind: "action" as const,
            label: "Archive",
            onClick: () => {
              // the Main slot stays (2026-09-16): the projection hides a
              // sink-resident note, so Archive still empties it from view —
              // and Restore brings it back to the folder it sat in
              archive.mutate(note.id);
            },
          });
        }
        if (selectedItems) {
          items.push({
            kind: "action" as const,
            label: `Move ${selectedItems.length} items to Trash`,
            danger: true,
            onClick: () => opts?.trashSelection?.(selectedItems),
          });
        } else if (sinkLane === "file" && fileLifecycle) {
          const rows = fileLifecycleRows(fileLifecycle);
          const movable = rows.movable;
          if (rows.error) useUiStore.getState().setRowActionError(rows.error);
          const moveFile = (sink: "Archive" | "Trash") => {
            if (!movable) return;
            useUiStore.getState().setRowActionError(null);
            void corpusMoveFileToSink(note.id, sink)
              .then(async () => {
                if (starred) togglePinQuick(note.id);
                usePanesStore.getState().closeFileTabs(note.id);
                await invalidateNotes();
              })
              .catch((err) =>
                useUiStore
                  .getState()
                  .setRowActionError(
                    `Couldn’t move “${note.title || "this file"}” to ${sink} — ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  ),
              );
          };
          items.push({
            kind: "action" as const,
            label: rows.archiveLabel,
            disabled: !movable,
            onClick: () => moveFile("Archive"),
          });
          items.push({
            kind: "action" as const,
            label: rows.trashLabel,
            danger: movable,
            disabled: !movable,
            onClick: () => moveFile("Trash"),
          });
        } else {
          items.push({
            kind: "action" as const,
            label: "Move to Trash",
            danger: true,
            onClick: () => {
              trash.mutate(note.id);
            },
          });
        }

        open(x, y, items, opts);
      })();
    },
    [
      open,
      openSummary,
      quickIds,
      manifest,
      setTree,
      liveIds,
      archive,
      trash,
      restore,
      setRenameTarget,
      setViewsManifest,
      viewsManifest,
      activeView,
    ],
  );
}
