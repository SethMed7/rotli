// useNoteMenu — one hook that builds the row menu for a note/file/board row and
// opens the context-menu store. Centralizes the item list + every handler so
// any surface (sidebar, All-notes, Recent, Main) wires it the same way:
// `const openMenu = useNoteMenu(); ... onContextMenu={(e) => openMenu(e, note)}`.
// The sidebar's "m" key opens the SAME menu with a synthetic anchor + a
// returnFocus that hands the cursor back to the row (the RowMenu unification).

import { useCallback } from "react";
import {
  corpusFileStat,
  corpusFrontmatter,
  corpusMoveFileToSink,
  corpusNoteAbsolutePath,
  corpusRevealFile,
  corpusRestoreFile,
  corpusSetLocalAiAccess,
  corpusSetLocked,
  corpusSetPinned,
  corpusSetSecure,
  isTauri,
} from "../lib/tauri";
import { discardBlankNote } from "../documents/draftComposition";
import { isEmptyNote } from "../services/mainDismiss";
import { markNoteDraftChanged } from "../services/noteDrafts";
import { DEST, isSink } from "../services/destinations";
import { invalidateNotes, useArchiveNote, useRestoreNote, useTrashNote } from "../services/hooks";
import { useMainGcIds } from "../services/hooks";
import { addNoteToMain, mainHasNote, removeFromMain } from "../services/mainTree";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useMainStore } from "../state/main";
import { useViewsStore } from "../state/views";
import { assignItemToView, assignedView, projectionMenuAction } from "../services/viewTree";
import { usePanesStore } from "../state/panes";
import { QUICK_MAX, togglePinQuick } from "../state/quick";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { noteDiskFolder } from "../lib/noteLocation";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import { openChatForNote } from "../noteChat/composition";

/** What the opener hands us — a real MouseEvent qualifies, and a keyboard
 * opener passes a plain {clientX, clientY} built from its row's rect. */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
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
    (e: MenuAnchor, note: NoteSummary, opts?: { returnFocus?: () => void }) => {
      // preventDefault MUST be synchronous (suppress the native menu before any
      // await), then the async build fetches lock/secure state before opening.
      e.preventDefault?.();
      e.stopPropagation?.();
      const x = e.clientX;
      const y = e.clientY;

      void (async () => {
        const isFile = note.kind === "file";
        // an archived/trashed note: open + Restore only — the lifecycle actions
        // don't apply until it's back (mirrors the retired RowMenu's split).
        // Gate on isSink (Archive/Trash), NOT isHidden: a STAGED capture lives
        // in Board (isHidden) yet is a live note that shows in All notes — it
        // must get the full menu, not a dead "Restore" that no-ops (Seth,
        // 2026-07-06: "Restore does nothing but I can see it in All notes").
        if (isSink(note.folderId)) {
          const restoreItem: MenuSpec = isFile
            ? {
                kind: "action" as const,
                label: "Restore to original folder",
                onClick: () => {
                  useUiStore.getState().setRowActionError(null);
                  void corpusRestoreFile(note.id)
                    .then(async () => {
                      usePanesStore.getState().closeFileTabs(note.id);
                      await invalidateNotes();
                    })
                    .catch((err) =>
                      useUiStore
                        .getState()
                        .setRowActionError(
                          `Couldn’t restore “${note.title || "this file"}” — ${
                            err instanceof Error ? err.message : String(err)
                          }`,
                        ),
                    );
                },
              }
            : {
                kind: "action" as const,
                label: "Restore",
                onClick: () => restore.mutate(note.id),
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

        const isBoard = note.kind === "board";
        const isNote = !isFile && !isBoard;
        const inMain = mainHasNote(manifest.tree, note.id);
        const currentView = assignedView(viewsManifest, note.id);
        const starred = quickIds.includes(note.id);
        const full = !starred && quickIds.length >= QUICK_MAX;
        // lock/secure aren't on NoteSummary — read them from frontmatter so the
        // menu shows the right toggle label + check (Seth #23, 2026-07-03: these
        // moved out of the metadata popover into this menu).
        const fm = isNote ? await corpusFrontmatter(note.id).catch(() => null) : null;
        const fileStat = isFile ? await corpusFileStat(note.id).catch(() => null) : null;
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
        items.push({
          kind: "action" as const,
          label: "Open in new tab",
          onClick: () => openSummary(note, { newTab: true }),
        });
        if (isNote) {
          items.push({
            kind: "action" as const,
            label: "Chat with this note",
            onClick: () => {
              useUiStore.getState().setRowActionError(null);
              void openChatForNote(note).catch((err) =>
                useUiStore
                  .getState()
                  .setRowActionError(
                    `Couldn’t open a chat for “${note.title || "this note"}” — ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  ),
              );
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
              // panes and look like a no-op (Seth, 2026-07-09).
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
            // silently no-op'd for months while the Rust side threw (Seth #63)
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
              // (Seth, 2026-07-07) — hard-discard, never into the Trash folder
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
            label: fm?.locked ? "Unlock — let the AI organize it" : "Lock from the AI",
            checked: !!fm?.locked,
            onClick: () => runFm("lock", corpusSetLocked(note.id, !fm?.locked)),
          });
          items.push({
            kind: "action" as const,
            label: fm?.secure ? "Remove secure protection" : "Mark secure — block remote AI",
            checked: !!fm?.secure,
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
            items.push({
              kind: "action" as const,
              label: fm.localAiAllowed ? "Revoke Local AI access" : "Allow Local AI on this Mac",
              checked: fm.localAiAllowed,
              onClick: () =>
                runFm("change Local AI access", corpusSetLocalAiAccess(note.id, !fm.localAiAllowed)),
            });
          }
        }
        if (!isFile) {
          items.push({ kind: "sep" as const });
          items.push({
            kind: "action" as const,
            label: "Rename…",
            onClick: () =>
              isBoard
                ? useUiStore.getState().setRenamingBoardId(note.id)
                : setRenameTarget({ id: note.id, current: note.title }),
          });
        }
        items.push({ kind: "sep" as const });
        if (!isFile) {
          items.push({
            kind: "action" as const,
            label: "Archive",
            onClick: () => {
              // a note leaving for a sink also leaves Main (Seth #5, 2026-07-08)
              if (inMain) setTree(removeFromMain(manifest.tree, note.id), liveIds);
              archive.mutate(note.id);
            },
          });
        }
        if (isFile) {
          const movable = fileStat?.lifecycleMutable === true;
          const moveFile = (sink: "Archive" | "Trash") => {
            if (!movable) return;
            useUiStore.getState().setRowActionError(null);
            void corpusMoveFileToSink(note.id, sink)
              .then(async () => {
                if (inMain) setTree(removeFromMain(manifest.tree, note.id), liveIds);
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
            label: movable ? "Move file to Archive" : "Read-only — can’t move file",
            disabled: !movable,
            onClick: () => moveFile("Archive"),
          });
          items.push({
            kind: "action" as const,
            label: movable ? "Move file to Trash" : "Read-only — can’t move file",
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
              if (inMain) setTree(removeFromMain(manifest.tree, note.id), liveIds);
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
