// The CHAT front (Seth's IA, 2026-08-01): a ChatGPT-style front over the
// memex's chats/ — New chat, a searchable All, the virtual chat folders, then
// every chat. It owns the whole sidebar body while it is the active front, so
// there is no cap and no "+N more": the list just scrolls
// (docs/design/sidebar-home-chat.md). Lifted wholesale out of sidebar.tsx.

import { useQuery } from "@tanstack/react-query";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { modelLabel, modelProvider } from "../../ai/models";
import { dispatch } from "../../keys/registry";
import { createDragGhost } from "../../lib/dragGhost";
import { createPointerDragSession } from "../../lib/pointerDrag";
import { type MemexChatSummary, chatModels, isTauri } from "../../lib/tauri";
import { archiveChat, deleteChat, pinChat, revealChat } from "../../memex/service";
import { invalidateMemex } from "../../memex/useMemex";
import {
  assignChatToFolder,
  createChatFolder,
  deleteChatFolder,
  renameChatFolder,
  setChatFolderPinned,
} from "../../services/chatFolders";
import { useChatRename } from "../../services/chatRename";
import { assignChatToView, chatAssignedView, viewChats } from "../../services/viewTree";
import { useChatRuns } from "../../state/chatRuns";
import { useContextMenu } from "../../state/contextMenu";
import { useFocusedChatSlug, usePanesStore } from "../../state/panes";
import { chatKey, useUiStore } from "../../state/ui";
import { useViewsStore } from "../../state/views";
import { ChevronRight, FolderGlyph, PinGlyph, PlusGlyph, SearchGlyph } from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";
import { chatMark } from "./chatMark";
import { ModelLogo } from "./modelLogo";
import { visibleSidebarChats } from "./sidebarChatProjection";
import { type SidebarChatData, chatFolderKey } from "./useChatFolders";

/** Where a dragged chat would land: a folder row (assignment — positional
 * reordering retired 2026-08-03, response recency rules). */
type ChatDrop = { kind: "folder"; id: string };

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

  // run signals (2026-08-03): pulsing while a chat answers, a dot once a reply
  // landed unwatched. Keys are vault-scoped, same as every per-chat map.
  const runs = useChatRuns((s) => s.runs);
  const clearUnread = useChatRuns((s) => s.clearUnread);
  const runKeyOf = (slug: string) => chatKey(activeMemex?.id ?? null, slug, "");

  // the per-chat model chip — the same cached catalog query the chat surface
  // uses; CLI labels resolve from the static catalog even when a lane is off
  const models = useQuery({
    queryKey: ["chat", "models"],
    queryFn: () => (isTauri() ? chatModels() : Promise.resolve([])),
    staleTime: Infinity,
  });
  const hybridPresets = useUiStore((s) => s.hybridPresets);
  const chatModelMap = useUiStore((s) => s.chatModel);
  const chatModelId = useUiStore((s) => s.chatModelId);

  // Chats participate in named views (2026-08-03), but an empty/legacy view
  // must not turn a non-empty Chat front into a blank list. Once that view has
  // at least one live chat membership it narrows normally.
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const viewsManifest = useViewsStore((s) => s.manifest);
  const viewsWritable = useViewsStore((s) => s.writable && s.hydrated);
  const setViewsManifest = useViewsStore((s) => s.setManifest);
  const visibleChats = visibleSidebarChats(
    chatList,
    activeView ? viewChats(viewsManifest, activeView) : null,
  );
  const visibleSlugs =
    visibleChats.length === chatList.length ? null : new Set(visibleChats.map((c) => c.slug));
  const inView = (c: MemexChatSummary) => visibleSlugs === null || visibleSlugs.has(c.slug);
  const showAllChats = () => {
    setActiveView(null);
    setContentView("allChats");
  };

  // the top lanes — views onto the list, not folders (rows also stay in their
  // real folder below). WORKING first (Seth, 2026-08-04: "a loading icon that
  // shows the chat is working, and it should be at the top"): a chat that is
  // answering right now floats above everything, including folders, so you
  // never hunt for it. Then UNREAD — replies that landed while you were away.
  const workingChats = chatList.filter((c) => inView(c) && runs[runKeyOf(c.slug)] === "running");
  const unreadChats = chatList.filter((c) => inView(c) && runs[runKeyOf(c.slug)] === "unread");

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
        const folderRow = el?.closest("[data-chatfolder-id]") as HTMLElement | null;
        const folderId = folderRow?.dataset.chatfolderId;
        target = folderId ? { kind: "folder", id: folderId } : null;
        setDrop(target);
      },
      onDrop: () => {
        // assignment only — positional reordering retired 2026-08-03 (response
        // recency owns the order inside a folder now)
        const d = target;
        if (d) update((m) => assignChatToFolder(m, slug, d.id));
      },
      onEnd: () => {
        setDragSlug(null);
        setDrop(null);
      },
    });
  };

  // one chat row, shared by folder groups and the loose list below them.
  // `hoisted` marks the COPY a lane (Working/Unread) lifts to the top: the same
  // chat still sits in its real place below, and only that one carries the
  // selected highlight — two lit rows for one open chat read as a bug (Seth,
  // 2026-08-04: "don't like double active"; same law as the All-chats rule).
  const renderChatRow = (c: MemexChatSummary, folderId: string | null, hoisted = false) =>
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
        /* a chat row lights only while the PANES actually show it — never
           alongside an active All-chats (or other) view (Seth, 2026-07-30:
           two highlights at once read as wrong) */
        className={`sb-chatrow${folderId ? " in-folder" : ""}${
          !hoisted && contentView === "panes" && focusedChatSlug === c.slug ? " sel" : ""
        }${dragSlug === c.slug ? " dragging" : ""}`}
        onPointerDown={(e) => startChatDrag(e, c.slug, c.title || c.slug)}
        onClick={() => {
          if (didDragRef.current) return;
          clearUnread(runKeyOf(c.slug));
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
            // chats organize by named view too (2026-08-03): work vs personal
            ...(viewsManifest.views.length > 0 && viewsWritable
              ? [
                  {
                    kind: "drill" as const,
                    label: "Move to view",
                    items: [
                      ...viewsManifest.views.map((view) => ({
                        kind: "action" as const,
                        label: view.name,
                        checked: chatAssignedView(viewsManifest, c.slug) === view.name,
                        checkedMark: "highlight" as const,
                        onClick: () => setViewsManifest(assignChatToView(viewsManifest, c.slug, view.name)),
                      })),
                      ...(chatAssignedView(viewsManifest, c.slug)
                        ? [
                            {
                              kind: "action" as const,
                              label: "Remove from view",
                              onClick: () => setViewsManifest(assignChatToView(viewsManifest, c.slug, null)),
                            },
                          ]
                        : []),
                    ],
                  },
                ]
              : []),
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
        {(() => {
          // the left slot carries the MODEL, not a chat glyph: in a list of
          // nothing but chats, "this is a chat" is the one thing you already
          // know (Seth, 2026-08-04). A chat with no model picked yet gets a
          // blank badge — it holds the column, and claims nothing.
          const ownModel = chatModelMap[runKeyOf(c.slug)];
          const id = ownModel ?? chatModelId;
          if (!id) return <span className="sb-chatmark none" title="No model picked yet" />;
          const name = modelLabel(id, models.data ?? [], hybridPresets);
          const mark = chatMark(modelProvider(id, models.data ?? [], hybridPresets), name);
          return (
            <span
              className={`sb-chatmark ${mark.key}${mark.logo ? " has-logo" : ""}`}
              title={mark.title}
              role={ownModel === undefined ? "img" : undefined}
              aria-label={ownModel === undefined ? mark.title : undefined}
              aria-hidden={ownModel !== undefined ? "true" : undefined}
            >
              {mark.logo ? <ModelLogo logo={mark.logo} /> : mark.initial}
            </span>
          );
        })()}
        <span className="fname">{c.title || c.slug}</span>
        {(() => {
          // run signal first (it's the newest fact), then the model chip
          const run = runs[runKeyOf(c.slug)];
          const ownModel = chatModelMap[runKeyOf(c.slug)];
          return (
            <>
              {run === "running" && (
                <span className="sb-chatrun running" role="status" aria-label="Answering…" />
              )}
              {run === "unread" && <span className="sb-chatrun unread" aria-label="New reply" />}
              {ownModel && !run && (
                <span className="sb-chatmodel">{modelLabel(ownModel, models.data ?? [], hybridPresets)}</span>
              )}
            </>
          );
        })()}
        {c.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
      </button>
    );

  return (
    <div className="sb-rows" aria-label="Chat" style={{ zoom }}>
      <div className="sb-chat">
        <button type="button" className="sb-chatnew" data-hotkey="chat.new" onClick={() => openChat(null)}>
          <PlusGlyph size={14} />
          <span>New chat</span>
        </button>
        <button
          type="button"
          /* highlight "All chats" only when its content view is active — so it
             never lights up alongside an open chat row (Seth, 2026-07-01) */
          className={`sb-chatrow all${contentView === "allChats" && !activeView ? " sel" : ""}`}
          data-hotkey="chat.all"
          onClick={showAllChats}
        >
          <SearchGlyph size={14} />
          <span className="fname">All chats</span>
        </button>
        {activeView && (
          <div className="sb-chatview" role="group" aria-label="Chat view context">
            <span className="sb-chatview-label">View</span>
            <span className="sb-chatview-name" title={activeView}>
              {activeView}
            </span>
            <button type="button" className="sb-chatview-all" onClick={showAllChats}>
              Show all chats
            </button>
          </div>
        )}
        {!activeMemex ? (
          <button type="button" className="sb-chat-empty" onClick={() => dispatch("app.settings")}>
            Connect a memex in Settings → Location
          </button>
        ) : chatList.length === 0 ? (
          <p className="sb-empty">No chats yet.</p>
        ) : (
          <>
            {/* the Working lane (2026-08-04) — only while something is actually
                running, so the sidebar stays quiet the rest of the time */}
            {workingChats.length > 0 && (
              <div className="sb-chatfolder sb-chatworking">
                <div className="sb-chatrow sb-chatfolder-row unreadhead" aria-hidden="true">
                  <span className="sb-chatrun running" />
                  <span className="fname">Working</span>
                  <span className="sb-chatfolder-n">{workingChats.length}</span>
                </div>
                {workingChats.map((c) => renderChatRow(c, null, true))}
              </div>
            )}
            {/* the Unread lane (2026-08-03): every reply that landed while you
                were elsewhere, newest first — a view onto the list, not a
                folder; rows also stay in their real folder below */}
            {unreadChats.length > 0 && (
              <div className="sb-chatfolder sb-chatunread">
                <div className="sb-chatrow sb-chatfolder-row unreadhead" aria-hidden="true">
                  <span className="sb-chatrun unread" />
                  <span className="fname">Unread</span>
                  <span className="sb-chatfolder-n">{unreadChats.length}</span>
                </div>
                {unreadChats.map((c) => renderChatRow(c, null, true))}
              </div>
            )}
            {grouped.folders.map(({ folder, chats: allFolderChats }) => {
              // an active view narrows every group to its own chats; a folder
              // with none simply doesn't render while the view is on
              const folderChats = allFolderChats.filter(inView);
              if (visibleSlugs !== null && folderChats.length === 0) return null;
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
                            label: folder.pinned ? "Unpin from top" : "Pin to top",
                            checked: folder.pinned === true,
                            onClick: () => update((m) => setChatFolderPinned(m, folder.id, !folder.pinned)),
                          },
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
                      {folder.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
                      <span className="sb-chatfolder-n">{folderChats.length}</span>
                    </button>
                  )}
                  {open && folderChats.map((c) => renderChatRow(c, folder.id))}
                </div>
              );
            })}
            {/* every loose chat — the front owns the whole body, so the old
                5/10/15 cap and its "+N more" row are retired (2026-08-01) */}
            {grouped.loose.filter(inView).map((c) => renderChatRow(c, null))}
          </>
        )}
      </div>
    </div>
  );
}
