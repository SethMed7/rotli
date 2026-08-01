// The CHAT front (Seth's IA, 2026-08-01): a ChatGPT-style front over the
// memex's chats/ — New chat, a searchable All, the virtual chat folders, then
// every chat. It owns the whole sidebar body while it is the active front, so
// there is no cap and no "+N more": the list just scrolls
// (docs/design/sidebar-home-chat.md). Lifted wholesale out of sidebar.tsx.

import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { dispatch } from "../../keys/registry";
import { createDragGhost } from "../../lib/dragGhost";
import { createPointerDragSession } from "../../lib/pointerDrag";
import { type MemexChatSummary, isTauri } from "../../lib/tauri";
import { archiveChat, deleteChat, pinChat, revealChat } from "../../memex/service";
import { invalidateMemex } from "../../memex/useMemex";
import {
  assignChatToFolder,
  createChatFolder,
  deleteChatFolder,
  renameChatFolder,
  setChatFolderOrder,
} from "../../services/chatFolders";
import { useChatRename } from "../../services/chatRename";
import { useContextMenu } from "../../state/contextMenu";
import { useFocusedChatSlug, usePanesStore } from "../../state/panes";
import { useUiStore } from "../../state/ui";
import { ChevronRight, ChatGlyph, FolderGlyph, PinGlyph, PlusGlyph, SearchGlyph } from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";
import { type SidebarChatData, chatFolderKey } from "./useChatFolders";

/** Where a dragged chat would land: into a folder, or beside a chat row. */
type ChatDrop =
  | { kind: "folder"; id: string }
  | { kind: "row"; slug: string; folderId: string; after: boolean };

export function SidebarChat({ chats, zoom }: { chats: SidebarChatData; zoom: number }) {
  const { activeMemex, chatList, manifest, grouped, update } = chats;
  const contentView = useUiStore((s) => s.contentView);
  const setContentView = useUiStore((s) => s.setContentView);
  const expandedDests = useUiStore((s) => s.expandedDests);
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const setRowActionError = useUiStore((s) => s.setRowActionError);
  const sidebarFolderNonce = useUiStore((s) => s.sidebarFolderNonce);
  const openContextMenu = useContextMenu((s) => s.open);
  const openChat = usePanesStore((s) => s.openChat);
  const focusedChatSlug = useFocusedChatSlug();
  const chatRename = useChatRename();
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  // the header's New-folder button, while Chat is the active front, mints a
  // CHAT folder and opens its rename inline — the nonce is the seam between
  // the shell's toolbar and the front that answers it (ui.requestSidebarFolder)
  const lastFolderNonce = useRef(sidebarFolderNonce);
  useEffect(() => {
    if (sidebarFolderNonce === lastFolderNonce.current) return;
    lastFolderNonce.current = sidebarFolderNonce;
    let createdId: string | null = null;
    update(
      (m) => {
        const created = createChatFolder(m, "New folder");
        createdId = created.id;
        return created.manifest;
      },
      () => {
        if (createdId) setRenamingFolderId(createdId);
      },
    );
    // `update` is rebuilt every render (it closes over the live manifest) —
    // depending on it would fire the effect forever; the nonce is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarFolderNonce]);

  // — drag a chat INTO a folder (Seth, 2026-07-30: "drag chat into the folder
  //   properly"): the Main tree's pointer-drag grammar (HTML5 DnD stays dead in
  //   the WKWebView shell). Dropping on a folder row assigns through the same
  //   manifest write the row menu uses; an in-folder row is a POSITION target;
  //   anywhere else abandons. The dragged row dims, the hovered folder tints,
  //   the title rides as a ghost. —
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [drop, setDrop] = useState<ChatDrop | null>(null);
  const didDragRef = useRef(false);
  const startChatDrag = (e: ReactPointerEvent, slug: string, label: string) => {
    // button guard BEFORE the ref reset — a right-click must not clear the
    // last drag's click suppression (the session guards again internally)
    if (e.button !== 0 || !activeMemex) return;
    let target: ChatDrop | null = null;
    didDragRef.current = false;
    createPointerDragSession(e, {
      ghost: (x, y) => createDragGhost(label, x, y),
      // didDragRef stays armed past onEnd so the trailing click is eaten
      onStart: () => {
        didDragRef.current = true;
        setDragSlug(slug);
      },
      onMove: (x, y) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        const row = el?.closest("[data-chat-infolder]") as HTMLElement | null;
        const rowSlug = row?.dataset.chatSlug;
        const rowFolder = row?.dataset.chatInfolder;
        if (row && rowSlug && rowFolder && rowSlug !== slug) {
          const rect = row.getBoundingClientRect();
          target = {
            kind: "row",
            slug: rowSlug,
            folderId: rowFolder,
            after: rect.height === 0 ? true : y > rect.top + rect.height / 2,
          };
          setDrop(target);
          return;
        }
        const folderRow = el?.closest("[data-chatfolder-id]") as HTMLElement | null;
        const folderId = folderRow?.dataset.chatfolderId;
        target = folderId ? { kind: "folder", id: folderId } : null;
        setDrop(target);
      },
      onDrop: () => {
        const d = target;
        if (!d) return;
        if (d.kind === "folder") {
          update((m) => assignChatToFolder(m, slug, d.id));
          return;
        }
        // reorder: rebuild the folder's RENDERED order with the dragged slug
        // spliced beside the target, then commit assignment + order together
        const group = grouped.folders.find(({ folder }) => folder.id === d.folderId);
        const slugs = (group?.chats ?? []).map((c) => c.slug).filter((s) => s !== slug);
        const at = slugs.indexOf(d.slug);
        if (at < 0) return;
        slugs.splice(d.after ? at + 1 : at, 0, slug);
        update((m) => setChatFolderOrder(assignChatToFolder(m, slug, d.folderId), d.folderId, slugs));
      },
      onEnd: () => {
        setDragSlug(null);
        setDrop(null);
      },
    });
  };

  // one chat row, shared by folder groups and the loose list below them
  const renderChatRow = (c: MemexChatSummary, folderId: string | null) =>
    chatRename.renamingChatSlug === c.slug ? (
      <InlineRenameInput
        key={c.slug}
        className="sb-chatrename"
        defaultValue={c.title || c.slug}
        ariaLabel="Rename chat"
        onCommit={(value) => chatRename.commit(c.slug, value)}
        onCancel={chatRename.cancel}
      />
    ) : (
      <button
        type="button"
        key={c.slug}
        data-chat-slug={c.slug}
        data-chat-infolder={folderId ?? undefined}
        /* a chat row lights only while the PANES actually show it — never
           alongside an active All-chats (or other) view (Seth, 2026-07-30:
           two highlights at once read as wrong) */
        className={`sb-chatrow${folderId ? " in-folder" : ""}${
          contentView === "panes" && focusedChatSlug === c.slug ? " sel" : ""
        }${dragSlug === c.slug ? " dragging" : ""}${
          drop?.kind === "row" && drop.slug === c.slug ? (drop.after ? " mdrop-after" : " mdrop-before") : ""
        }`}
        onPointerDown={(e) => startChatDrag(e, c.slug, c.title || c.slug)}
        onClick={() => {
          if (didDragRef.current) return;
          openChat(c.slug);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // failures (e.g. a read-only brain) land in the sidebar's inline
          // error note — the menu is gone by the time they reject (#11
          // pattern; reviewer, 2026-07-08)
          const runChatOp = (verb: string, op: Promise<void>) => {
            setRowActionError(null);
            void op
              .then(() => invalidateMemex())
              .catch((err) =>
                setRowActionError(
                  `Couldn't ${verb} this chat — ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          };
          const assignedFolder = manifest.assignments[c.slug];
          openContextMenu(e.clientX, e.clientY, [
            // the open verbs mirror the note row's menu (Seth, 2026-07-30:
            // "pretty much the same things as the notes")
            {
              kind: "action" as const,
              label: "Open in new tab",
              onClick: () => openChat(c.slug, { newTab: true }),
            },
            {
              kind: "action" as const,
              label: "Open to the right",
              onClick: () => usePanesStore.getState().openToSide("chat", c.slug),
            },
            { kind: "sep" as const },
            {
              kind: "action" as const,
              label: c.pinned ? "Unpin from top" : "Pin to top",
              checked: c.pinned,
              onClick: () => {
                if (activeMemex) runChatOp("pin", pinChat(activeMemex, c.slug, !c.pinned));
              },
            },
            {
              kind: "action" as const,
              label: "Rename…",
              onClick: () => chatRename.start(c.slug),
            },
            {
              kind: "drill" as const,
              label: "Move to folder",
              items: [
                ...manifest.folders.map((folder) => ({
                  kind: "action" as const,
                  label: folder.name,
                  checked: assignedFolder === folder.id,
                  checkedMark: "highlight" as const,
                  onClick: () => update((m) => assignChatToFolder(m, c.slug, folder.id)),
                })),
                ...(assignedFolder
                  ? [
                      {
                        kind: "action" as const,
                        label: "Remove from folder",
                        onClick: () => update((m) => assignChatToFolder(m, c.slug, null)),
                      },
                    ]
                  : []),
                ...(manifest.folders.length > 0 ? [{ kind: "sep" as const }] : []),
                {
                  kind: "action" as const,
                  label: "New folder…",
                  onClick: () => {
                    // create + assign in one write, then open the rename box
                    let createdId: string | null = null;
                    update(
                      (m) => {
                        const created = createChatFolder(m, "New folder");
                        createdId = created.id;
                        return assignChatToFolder(created.manifest, c.slug, created.id);
                      },
                      () => {
                        if (createdId) setRenamingFolderId(createdId);
                      },
                    );
                  },
                },
              ],
            },
            {
              kind: "action" as const,
              label: "Show in Finder",
              disabled: !isTauri(),
              onClick: () => {
                if (!activeMemex) return;
                setRowActionError(null);
                void revealChat(activeMemex, c.slug).catch((err) =>
                  setRowActionError(
                    `Couldn't reveal in Finder — ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
              },
            },
            {
              kind: "action" as const,
              // the chat IS a file on disk (chats/<slug>.md) — surface that
              // truth right in the row menu
              label: "Copy file path",
              onClick: () => {
                if (activeMemex) {
                  void navigator.clipboard.writeText(`${activeMemex.root}/chats/${c.slug}.md`);
                }
              },
            },
            { kind: "sep" as const },
            {
              kind: "action" as const,
              label: "Archive",
              onClick: () => {
                if (activeMemex) runChatOp("archive", archiveChat(activeMemex, c.slug));
              },
            },
            {
              kind: "action" as const,
              label: "Delete",
              danger: true,
              onClick: () => {
                if (activeMemex) runChatOp("delete", deleteChat(activeMemex, c.slug));
              },
            },
          ]);
        }}
        title={c.title || c.slug}
      >
        <ChatGlyph size={14} />
        <span className="fname">{c.title || c.slug}</span>
        {c.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
      </button>
    );

  return (
    <div className="sb-rows" aria-label="Chat" style={{ zoom }}>
      <div className="sb-chat">
        <button type="button" className="sb-chatnew" onClick={() => openChat(null)}>
          <PlusGlyph size={14} />
          <span>New chat</span>
        </button>
        <button
          type="button"
          /* highlight "All chats" only when its content view is active — so it
             never lights up alongside an open chat row (Seth, 2026-07-01) */
          className={`sb-chatrow all${contentView === "allChats" ? " sel" : ""}`}
          onClick={() => setContentView("allChats")}
        >
          <SearchGlyph size={14} />
          <span className="fname">All chats</span>
        </button>
        {!activeMemex ? (
          <button type="button" className="sb-chat-empty" onClick={() => dispatch("app.settings")}>
            Connect a memex in Settings → Location
          </button>
        ) : chatList.length === 0 ? (
          <p className="sb-empty">No chats yet.</p>
        ) : (
          <>
            {grouped.folders.map(({ folder, chats: folderChats }) => {
              const folderKey = chatFolderKey(folder.id);
              const open = expandedDests[folderKey] ?? true;
              return (
                <div key={folder.id} className="sb-chatfolder">
                  {renamingFolderId === folder.id ? (
                    <InlineRenameInput
                      className="sb-chatrename"
                      defaultValue={folder.name}
                      ariaLabel="Rename chat folder"
                      onCommit={(value) => {
                        setRenamingFolderId(null);
                        update((m) => renameChatFolder(m, folder.id, value));
                      }}
                      onCancel={() => setRenamingFolderId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`sb-chatrow sb-chatfolder-row${
                        drop?.kind === "folder" && drop.id === folder.id ? " chatdrop" : ""
                      }`}
                      data-chatfolder-id={folder.id}
                      aria-expanded={open}
                      onClick={() => setDestExpanded(folderKey, !open)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openContextMenu(e.clientX, e.clientY, [
                          {
                            kind: "action" as const,
                            label: "Rename…",
                            onClick: () => setRenamingFolderId(folder.id),
                          },
                          { kind: "sep" as const },
                          {
                            kind: "action" as const,
                            // frees the chats back to the list — files never move
                            label: "Delete folder",
                            danger: true,
                            onClick: () => update((m) => deleteChatFolder(m, folder.id)),
                          },
                        ]);
                      }}
                      title={folder.name}
                    >
                      {/* the Notes tree's disclosure grammar (Seth,
                          2026-07-30: "needs to be clear what is a
                          folder") — rotating chevron + folder glyph */}
                      <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                        <ChevronRight size={10} />
                      </span>
                      <FolderGlyph size={14} />
                      <span className="fname">{folder.name}</span>
                      <span className="sb-chatfolder-n">{folderChats.length}</span>
                    </button>
                  )}
                  {open && folderChats.map((c) => renderChatRow(c, folder.id))}
                </div>
              );
            })}
            {/* every loose chat — the front owns the whole body, so the old
                5/10/15 cap and its "+N more" row are retired (2026-08-01) */}
            {grouped.loose.map((c) => renderChatRow(c, null))}
          </>
        )}
      </div>
    </div>
  );
}
