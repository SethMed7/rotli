// The CHAT front (design A, 2026-11-24): New chat, Search chats, the Projects
// list (sidebarChatProjects.tsx), then Recents — every chat once, by reply
// recency, a chat in a project wearing a quiet project tag. It owns the whole
// sidebar body while it is the active front, so the list just scrolls
// (docs/design/sidebar-home-chat.md). Model usage and named views are not
// here: usage opens from ⌘K and Settings, and views belong to Home.

import { useQuery } from "@tanstack/react-query";
import { type PointerEvent as ReactPointerEvent, useEffect, useEffectEvent, useRef, useState } from "react";

import { modelLabel, modelProvider } from "../../ai/models";
import { createDragGhost } from "../../lib/dragGhost";
import { PLATFORM } from "../../lib/featurePolicy";
import { createPointerDragSession } from "../../lib/pointerDrag";
import { pinActionLabel } from "../../lib/sidebarLook";
import { type MemexChatSummary, chatModels, isTauri } from "../../lib/tauri";
import { useNow } from "../../lib/useNow";
import { chatsDirOf } from "../../memex/config";
import { archiveChat, deleteChat, pinChat, revealChat } from "../../memex/service";
import { invalidateMemex } from "../../memex/useMemex";
import { assignChatToFolder, chatActivityMs, renameChatFolder } from "../../services/chatFolders";
import { useChatRename } from "../../services/chatRename";
import { useChatRuns } from "../../state/chatRuns";
import { useContextMenu } from "../../state/contextMenu";
import { leaves, useFocusedChatSlug, usePanesStore } from "../../state/panes";
import { chatKey, useUiStore } from "../../state/ui";
import { useChatFirstVisitDone } from "../chat/chatConnectModels";
import { MoreGlyph, PinGlyph, PlusGlyph, SearchGlyph } from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";
import { chatFileMenuItems, chatFinderMenuItems } from "./chatFileActions";
import { chatMark } from "./chatMark";
import { ModelLogo } from "./modelLogo";
import { ProjectTag } from "./projectRow";
import { chatRowSignal, relativeChatAge } from "./sidebarChatProjection";
import { SidebarChatProjects, createProject } from "./sidebarChatProjects";
import type { SidebarChatData } from "./useChatFolders";
import { useConnectVault } from "./useConnectVault";

/** Where a dragged chat would land: a project row. */
type ChatDrop = { kind: "project"; id: string };

export function SidebarChat({ chats, zoom }: { chats: SidebarChatData; zoom: number }) {
  const now = useNow();
  const { activeMemex, chatList, manifest, update } = chats;
  const contentView = useUiStore((s) => s.contentView);
  const setContentView = useUiStore((s) => s.setContentView);
  const setRowActionError = useUiStore((s) => s.setRowActionError);
  // no vault yet: connect one right here (the vault menu's Connect flow)
  const { connectVault } = useConnectVault();
  const sidebarFolderNonce = useUiStore((s) => s.sidebarFolderNonce);
  const openContextMenu = useContextMenu((s) => s.open);
  const openChat = usePanesStore((s) => s.openChat);
  // New chat starts a chat, past the first-visit chooser (chatConnectModels.tsx)
  const newChat = () => {
    useChatFirstVisitDone.getState().show();
    openChat(null, chats.activeMemex ? { vaultId: chats.activeMemex.id } : undefined);
  };
  // the first time Chat opens in a vault with no chats, land on a new chat
  // (with the model chooser) instead of an empty pane — once per session
  const autoOpened = useRef(false);
  useEffect(() => {
    // the Mac app's first-visit chooser is where this leads; Rotli Web keeps its own guide
    if (PLATFORM !== "desktop" || autoOpened.current || !chats.activeMemex || !chats.chatsLoaded) return;
    if (chats.chatList.length !== 0) return;
    if (
      leaves(usePanesStore.getState().root).some((leaf) =>
        leaf.tabs.some((tab) => tab.surfaceKind === "chat"),
      )
    )
      return;
    autoOpened.current = true;
    openChat(null, { vaultId: chats.activeMemex.id });
  }, [chats.activeMemex, chats.chatsLoaded, chats.chatList.length, openChat]);
  const focusedChatSlug = useFocusedChatSlug();
  const chatRename = useChatRename();
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  // Run signals (2026-08-03): a quiet static dot while a chat answers, a
  // full-strength dot once a reply lands unwatched. Keys are vault-scoped,
  // same as every per-chat map; the state change renders once and stays still.
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

  // Search chats opens the searchable All chats list
  const searchChats = () => setContentView("allChats");

  // the header's New-folder button, while Chat is the active front, mints a
  // chat PROJECT and opens its rename inline — the nonce is the seam between
  // the shell's toolbar and the front that answers it (ui.requestSidebarFolder)
  const lastFolderNonce = useRef(sidebarFolderNonce);
  // `update` closes over the live manifest: an effect event, the nonce the trigger
  const createFolderFromToolbar = useEffectEvent((nonce: number) => {
    if (nonce === lastFolderNonce.current) return;
    lastFolderNonce.current = nonce;
    createProject(update, setRenamingFolderId);
  });
  useEffect(() => createFolderFromToolbar(sidebarFolderNonce), [sidebarFolderNonce]);

  // — drag a chat ONTO a project row: the Main tree's pointer-drag grammar
  //   (HTML5 DnD stays dead in the WKWebView shell). Dropping on a project row
  //   assigns through the same manifest write the row menu uses; anywhere else
  //   abandons. The dragged row dims, the hovered project tints, the title
  //   rides as a ghost. —
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
        const projectRow = el?.closest("[data-chatproject-id]") as HTMLElement | null;
        const projectId = projectRow?.dataset.chatprojectId;
        target = projectId ? { kind: "project", id: projectId } : null;
        setDrop(target);
      },
      onDrop: () => {
        // assignment only — reply recency owns the order
        const d = target;
        if (d) update((m) => assignChatToFolder(m, slug, d.id));
      },
      onEnd: () => {
        setDragSlug(null);
        setDrop(null);
      },
    });
  };

  const openChatActions = (c: MemexChatSummary, x: number, y: number) => {
    // failures (e.g. a read-only brain) land in the sidebar's inline error
    // note — the menu is gone by the time they reject (#11 pattern).
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
    const assignedProject = manifest.assignments[c.slug];
    openContextMenu(x, y, [
      {
        kind: "action" as const,
        label: "Open in new tab",
        onClick: () =>
          openChat(c.slug, {
            newTab: true,
            ...(chats.activeMemex ? { vaultId: chats.activeMemex.id } : {}),
          }),
      },
      {
        kind: "action" as const,
        label: "Open to the right",
        onClick: () => usePanesStore.getState().openToSide("chat", c.slug),
      },
      ...chatFileMenuItems(c), // the transcript file, as written
      { kind: "sep" as const },
      {
        kind: "action" as const,
        label: pinActionLabel(c.pinned),
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
        label: "Add to project",
        items: [
          ...manifest.folders.map((folder) => ({
            kind: "action" as const,
            label: folder.name,
            checked: assignedProject === folder.id,
            checkedMark: "highlight" as const,
            onClick: () => update((m) => assignChatToFolder(m, c.slug, folder.id)),
          })),
          ...(assignedProject
            ? [
                {
                  kind: "action" as const,
                  label: "Remove from project",
                  onClick: () => update((m) => assignChatToFolder(m, c.slug, null)),
                },
              ]
            : []),
          ...(manifest.folders.length > 0 ? [{ kind: "sep" as const }] : []),
          {
            kind: "action" as const,
            label: "New project…",
            onClick: () => createProject(update, setRenamingFolderId, c.slug),
          },
        ],
      },
      ...chatFinderMenuItems(PLATFORM, isTauri(), () => {
        if (!activeMemex) return;
        setRowActionError(null);
        void revealChat(activeMemex, c.slug).catch((err) =>
          setRowActionError(
            `Couldn't reveal in Finder — ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }),
      {
        kind: "action" as const,
        label: "Copy file path",
        onClick: () => {
          if (activeMemex) {
            void navigator.clipboard.writeText(`${activeMemex.root}/${chatsDirOf(activeMemex)}/${c.slug}.md`);
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
  };

  // one chat row. Each chat appears exactly once, in reply-recency order —
  // its own dot says Working or Unread reply, and a chat in a project wears
  // the project's name as a quiet tag.
  const projectNames = new Map(manifest.folders.map((folder) => [folder.id, folder.name]));
  const renderChatRow = (c: MemexChatSummary) => {
    const signal = chatRowSignal(runs[runKeyOf(c.slug)]);
    const projectName = projectNames.get(manifest.assignments[c.slug] ?? "");
    const selected = contentView === "panes" && focusedChatSlug === c.slug;
    return chatRename.renamingChatSlug === c.slug ? (
      <InlineRenameInput
        key={c.slug}
        className="sb-chatrename"
        defaultValue={c.title || c.slug}
        ariaLabel="Rename chat"
        onCommit={(value) => chatRename.commit(c.slug, value)}
        onCancel={chatRename.cancel}
      />
    ) : (
      <div
        key={c.slug}
        data-chat-slug={c.slug}
        /* a chat row lights only while the PANES actually show it — never
           alongside an active All-chats (or other) view (the maintainer, 2026-07-30:
           two highlights at once read as wrong) */
        className={`sb-chatrow${selected ? " sel" : ""}${dragSlug === c.slug ? " dragging" : ""}`}
        onPointerDown={(e) => startChatDrag(e, c.slug, c.title || c.slug)}
        onClick={() => {
          if (didDragRef.current) return;
          clearUnread(runKeyOf(c.slug));
          openChat(c.slug, chats.activeMemex ? { vaultId: chats.activeMemex.id } : undefined);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openChatActions(c, e.clientX, e.clientY);
        }}
      >
        <button
          type="button"
          className="sb-chatrow-open"
          aria-label={`Open chat ${c.title || c.slug}${projectName ? `, in ${projectName}` : ""}${
            signal ? `, ${signal.label}` : ""
          }`}
          aria-current={selected ? "page" : undefined}
          title={c.title || c.slug}
        />
        {(() => {
          // the left slot carries the MODEL, not a chat glyph: in a list of
          // nothing but chats, "this is a chat" is the one thing you already
          // know. A chat with no model picked yet gets a blank badge — it holds the column, and claims nothing.
          const ownModel = c.model || chatModelMap[runKeyOf(c.slug)];
          const id = ownModel ?? chatModelId;
          if (!id) return <span className="sb-chatmark none" title="No model picked yet" />;
          const name = modelLabel(id, models.data ?? [], hybridPresets);
          const mark = chatMark(c.provider || modelProvider(id, models.data ?? [], hybridPresets), name);
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
        {projectName && <ProjectTag name={projectName} />}
        {/* The right edge carries the live signal dot (Working pulses, an
            Unread reply holds still in accent) beside the age of the last
            reply; hovering or focusing swaps the age for one stable action
            slot without moving the title. Nothing here ever truncates. */}
        <span className="sb-chattrail">
          {signal && (
            <span
              className={`sb-chatsignal ${signal.kind}`}
              role="img"
              aria-label={signal.label}
              title={signal.label}
            />
          )}
          <span className="sb-chattime">{relativeChatAge(now, chatActivityMs(c))}</span>
          <button
            type="button"
            className="sb-chataction"
            aria-label={`More actions for ${c.title || c.slug}`}
            title="More actions"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              openChatActions(c, rect.right, rect.bottom);
            }}
          >
            <MoreGlyph size={14} />
          </button>
        </span>
        {c.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
      </div>
    );
  };

  return (
    <div className="sb-rows" aria-label="Chat" style={{ zoom }}>
      <div className="sb-chat">
        <button type="button" className="sb-chatnew" data-hotkey="chat.new" onClick={newChat}>
          <PlusGlyph size={14} />
          <span>New chat</span>
        </button>
        <button
          type="button"
          /* lit only while the search list is open, never beside an open chat row */
          className={`sb-chatrow all${contentView === "allChats" ? " sel" : ""}`}
          data-hotkey="chat.all"
          onClick={searchChats}
        >
          <SearchGlyph size={14} />
          <span className="fname">Search chats</span>
        </button>
        {!activeMemex ? (
          <button
            type="button"
            className="sb-chat-empty"
            onClick={() =>
              void connectVault().catch((err: unknown) =>
                setRowActionError(
                  `Couldn't connect that folder — ${err instanceof Error ? err.message : String(err)}`,
                ),
              )
            }
          >
            Connect vault
          </button>
        ) : (
          <>
            {/* projects show before the first chat exists */}
            <SidebarChatProjects
              chats={chats}
              dropId={drop?.id ?? null}
              renamingId={renamingFolderId}
              setRenamingId={setRenamingFolderId}
              onRename={(id, name) => update((m) => renameChatFolder(m, id, name))}
            />
            {chatList.length === 0 ? (
              <p className="sb-empty">No chats yet.</p>
            ) : (
              chatList.map((c) => renderChatRow(c))
            )}
          </>
        )}
      </div>
    </div>
  );
}
