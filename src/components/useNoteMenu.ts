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
  corpusRevealFile,
  corpusSetLocalAiAccess,
  corpusSetLocked,
  corpusSetPinned,
  corpusSetSecure,
  corpusTrashFile,
} from "../lib/tauri";
import { fileNoteToArea } from "../services/brainFiling";
import { isEmptyNote } from "../services/mainDismiss";
import { DEST, isSink } from "../services/destinations";
import { invalidateNotes, useArchiveNote, useBrainAreas, useRestoreNote, useTrashNote } from "../services/hooks";
import { useMainGcIds } from "../services/hooks";
import { addNoteToMain, mainHasNote, removeFromMain } from "../services/mainTree";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useMainStore } from "../state/main";
import { usePanesStore } from "../state/panes";
import { QUICK_MAX, togglePinQuick } from "../state/quick";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { noteDiskFolder } from "../lib/noteLocation";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";

/** What the opener hands us — a real MouseEvent qualifies, and a keyboard
 * opener passes a plain {clientX, clientY} built from its row's rect. */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export function useNoteMenu() {
  const open = useContextMenu((s) => s.open);
  const openSummary = usePanesStore((s) => s.openSummary);
  const quickIds = useUiStore((s) => s.quickNoteIds);
  const setRenameTarget = useUiStore((s) => s.setRenameTarget);
  const manifest = useMainStore((s) => s.manifest);
  const setTree = useMainStore((s) => s.setTree);
  // GC liveIds MUST be the FULL note index (staged/archived/trashed included):
  // setTree prunes any Main ref not in this set, so building it from useNotes()
  // alone made "Add to Main" on a STAGED note a silent no-op — the add and the
  // GC of it happened in the same call. undefined until every listing loaded
  // (a still-loading or errored vault must not read as "gone" — skip the GC).
  const liveIds = useMainGcIds();
  const archive = useArchiveNote();
  const trash = useTrashNote();
  const restore = useRestoreNote();
  // the Brain's area vocabulary for the filing drill — shared with MetaPanel
  const areas = useBrainAreas();

  return useCallback(
    (e: MenuAnchor, note: NoteSummary, opts?: { returnFocus?: () => void }) => {
      // preventDefault MUST be synchronous (suppress the native menu before any
      // await), then the async build fetches lock/secure state before opening.
      e.preventDefault?.();
      e.stopPropagation?.();
      const x = e.clientX;
      const y = e.clientY;

      void (async () => {
        // an archived/trashed note: open + Restore only — the lifecycle actions
        // don't apply until it's back (mirrors the retired RowMenu's split).
        // Gate on isSink (Archive/Trash), NOT isHidden: a STAGED capture lives
        // in Board (isHidden) yet is a live note that shows in All notes — it
        // must get the full menu, not a dead "Restore" that no-ops (Seth,
        // 2026-07-06: "Restore does nothing but I can see it in All notes").
        if (isSink(note.folderId)) {
          open(
            x,
            y,
            [
              {
                kind: "action" as const,
                label: "Open in new tab",
                onClick: () => openSummary(note, { newTab: true }),
              },
              { kind: "sep" as const },
              {
                kind: "action" as const,
                label: "Restore",
                onClick: () => restore.mutate(note.id),
              },
            ],
            opts,
          );
          return;
        }

        const isFile = note.kind === "file";
        const isBoard = note.kind === "board";
        const isNote = !isFile && !isBoard;
        const inMain = mainHasNote(manifest.tree, note.id);
        const starred = quickIds.includes(note.id);
        const full = !starred && quickIds.length >= QUICK_MAX;
        // lock/secure aren't on NoteSummary — read them from frontmatter so the
        // menu shows the right toggle label + check (Seth #23, 2026-07-03: these
        // moved out of the metadata popover into this menu).
        const fm = isNote ? await corpusFrontmatter(note.id).catch(() => null) : null;
        const fileStat = isFile ? await corpusFileStat(note.id).catch(() => null) : null;
        const secureAtHome =
          isNote &&
          (isSecureBrainFolder(noteDiskFolder(note)) || isSecureNotesFolder(noteDiskFolder(note)));

        // frontmatter toggles surface failures in the sidebar's inline error
        // note (the menu is gone by the time a write fails — #11 pattern)
        const runFm = (verb: string, op: Promise<unknown>) => {
          useUiStore.getState().setRowActionError(null);
          void op.then(invalidateNotes).catch((err) =>
            useUiStore
              .getState()
              .setRowActionError(
                `Couldn't ${verb} — ${err instanceof Error ? err.message : String(err)}`,
              ),
          );
        };

        const items: MenuSpec[] = [];
        items.push({
          kind: "action" as const,
          label: "Open in new tab",
          onClick: () => openSummary(note, { newTab: true }),
        });
        items.push({
          kind: "action" as const,
          label: "Show in Brain",
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
        items.push({ kind: "sep" as const });
        if (!isBoard) {
          items.push({
            kind: "action" as const,
            label: starred ? "Unstar — remove from Quick access" : "Star for Quick access",
            checked: starred,
            disabled: full,
            onClick: () => togglePinQuick(note.id),
          });
        }
        items.push({
          kind: "action" as const,
          label: inMain ? "Remove from Main" : "Add to Main",
          onClick: () => {
            if (inMain) {
              setTree(removeFromMain(manifest.tree, note.id), liveIds);
              // an empty note pulled into Main and never written in is deleted on
              // dismiss (Seth, 2026-07-07) — otherwise just unlink from Main
              void isEmptyNote(note.id).then((empty) => {
                if (empty) trash.mutate(note.id);
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
              label: "Move into Brain › Secure notes",
              onClick: () => runFm("move to Secure notes", corpusSetSecure(note.id, true)),
            });
          }
          if (fm?.secure) {
            items.push({
              kind: "action" as const,
              label: fm.localAiAllowed
                ? "Revoke Local AI access"
                : "Allow Local AI on this Mac",
              checked: fm.localAiAllowed,
              onClick: () =>
                runFm(
                  "change Local AI access",
                  corpusSetLocalAiAccess(note.id, !fm.localAiAllowed),
                ),
            });
          }
        }
      // file into a Brain area right here — the 0.17.0 fast-follow; same Filer
      // path as the metadata panel. Offered for STAGED notes (they project to
      // the Captures "Board" folder on the wire — a .md note's id is a ULID, so
      // the folder is the sync-readable signal) and for notes already in an
      // area (re-file). fileNoteToArea resolves the ULID→rel bridge itself.
      const diskFolder = noteDiskFolder(note);
      const fileable =
        note.folderId === DEST.board ||
        diskFolder === "wiki" ||
        diskFolder.startsWith("wiki/");
      if (!isFile && !isBoard && fileable && areas.length > 0) {
        items.push({
          kind: "drill" as const,
          label: "File to the Brain",
          items: areas.map((area) => ({
            kind: "action" as const,
            label: area.charAt(0).toUpperCase() + area.slice(1),
            onClick: () => {
              // failures surface as the sidebar's inline error note — the menu
              // is closed by the time the write fails (#11, audit 2026-07)
              useUiStore.getState().setRowActionError(null);
              void fileNoteToArea(note.id, area).catch((err) =>
                useUiStore
                  .getState()
                  .setRowActionError(
                    `Couldn’t file “${note.title || "this note"}” to the Brain — ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  ),
              );
            },
          })),
        });
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
        const trashable = fileStat?.trashable === true;
        items.push({
          kind: "action" as const,
          label: trashable ? "Move file to Trash" : "Read-only — can’t move to Trash",
          danger: trashable,
          disabled: !trashable,
          onClick: () => {
            if (!trashable) return;
            useUiStore.getState().setRowActionError(null);
            void corpusTrashFile(note.id)
              .then(async () => {
                if (inMain) setTree(removeFromMain(manifest.tree, note.id), liveIds);
                usePanesStore.getState().closeFileTabs(note.id);
                await invalidateNotes();
              })
              .catch((err) =>
                useUiStore
                  .getState()
                  .setRowActionError(
                    `Couldn’t move “${note.title || "this file"}” to Trash — ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  ),
              );
          },
        });
      } else {
        items.push({
          kind: "action" as const,
          label: "Delete",
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
    [open, openSummary, quickIds, manifest, setTree, liveIds, archive, trash, restore, setRenameTarget, areas],
  );
}
