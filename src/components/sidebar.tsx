// The sidebar SHELL. It owns the chrome that is true of every front — the vault
// header row, the create/collapse toolbar, the inline error lane, the front
// switcher, and the utility footer — then hands the body to whichever front is
// active (Seth's IA, 2026-08-01; docs/design/sidebar-home-chat.md):
//
//   Home  → src/components/sidebar/sidebarHome.tsx   (notes; System zone)
//   Chat  → src/components/sidebar/sidebarChat.tsx   (chats; folders)
//   Breve → src/components/breve/breveSidebar.tsx    (a MODE, not a front)
//
// The stacked "Chat ›" / "Notes ›" accordions are gone: each front owns the
// whole body and scrolls on its own, so nothing has to be folded to make room
// for anything else.

import { type MouseEvent, useEffect, useRef } from "react";

import { dispatch } from "../keys/registry";
import { initMemexAsCorpus, pickFolder } from "../memex/service";
import { useChooseFolder, useConnectBrain, useMemexConfig } from "../memex/useMemex";
import { openNewItemMenu } from "../newItems/menu";
import { mainFolderIds } from "../services/mainTree";
import { buildVaultMenu, vaultDisplayName } from "../services/vaultSwitcher";
import { useContextMenu } from "../state/contextMenu";
import { useFocusedTab } from "../state/panes";
import { useUiStore } from "../state/ui";
import { BreveSidebar } from "./breve/breveSidebar";
import { QuokkaMark } from "./character";
import { ChevronRight, CoffeeGlyph, NewFileGlyph, NewFolderGlyph, VaultGlyph } from "./glyphs";
import { SidebarChat } from "./sidebar/sidebarChat";
import { SidebarFooter } from "./sidebar/sidebarFooter";
import { SidebarHome } from "./sidebar/sidebarHome";
import { SidebarSwitcher, sidebarFrontBody, sidebarFrontSelection } from "./sidebar/sidebarSwitcher";
import { useActiveTree } from "./sidebar/useActiveTree";
import { useChatFolders } from "./sidebar/useChatFolders";

/** Collapse-all glyph — two chevrons folding toward the center ("fold the tree
 * up"). Inline like RestoreGlyph; same 1.7 stroke / 24-viewBox family. */
function FoldGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 9l5-5 5 5M7 20l5-5 5 5" />
    </svg>
  );
}

export function Sidebar() {
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const sidebarView = useUiStore((s) => s.sidebarView);
  const setSidebarView = useUiStore((s) => s.setSidebarView);
  const sidebarZoom = useUiStore((s) => s.sidebarZoom);
  const contentView = useUiStore((s) => s.contentView);
  const dashboardSection = useUiStore((s) => s.dashboardSection);
  const setDashboardSection = useUiStore((s) => s.setDashboardSection);
  const collapseAllDests = useUiStore((s) => s.collapseAllDests);
  const requestSystemFolder = useUiStore((s) => s.requestSystemFolder);
  const requestSidebarFolder = useUiStore((s) => s.requestSidebarFolder);
  const rowActionError = useUiStore((s) => s.rowActionError);
  const setRowActionError = useUiStore((s) => s.setRowActionError);
  const openContextMenu = useContextMenu((s) => s.open);

  // the chat world's data — the Chat front renders it, and collapse-all needs
  // its folder keys here (chat folders default OPEN, so wiping the map would
  // re-EXPAND them, #83). One react-query key: the second read is the cache.
  const chats = useChatFolders();
  const activeTree = useActiveTree();

  // — the vault switcher (decision 2026-07-25): the sidebar header names the
  //   current vault and opens one menu — switch (repoints the notes folder,
  //   which relaunches), connect another, or open Location settings. Menu
  //   grammar lives in services/vaultSwitcher.ts (pure, tested). —
  const memexCfg = useMemexConfig();
  const chooseFolderMut = useChooseFolder();
  const connectBrainMut = useConnectBrain();
  const vaultName = vaultDisplayName(memexCfg.data?.instances ?? []);
  const openVaultMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const vaultErr = (verb: string) => (err: unknown) =>
      setRowActionError(`Couldn’t ${verb} — ${err instanceof Error ? err.message : String(err)}`);
    const items = buildVaultMenu(memexCfg.data?.instances ?? [], {
      switchTo: (root) => void chooseFolderMut.mutateAsync(root).catch(vaultErr("switch vaults")),
      connect: () => void connectBrainMut.mutateAsync(undefined).catch(vaultErr("connect the vault")),
      // "New vault…": pick an empty folder, scaffold a vault, switch into it
      createNew: () =>
        void pickFolder()
          .then((path) => (path ? initMemexAsCorpus(path) : undefined))
          .catch(vaultErr("create the vault")),
      // Location lives inside Settings — the pane picker is one click away
      openSettings: () => dispatch("app.settings"),
    });
    const trigger = e.currentTarget;
    const rect = trigger.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, items, { returnFocus: () => trigger.focus() });
  };

  // — the front follows the focused tab (2026-08-01). Every navigation reveal —
  //   ⌘K, a deep link, Quick Look, chat summon, a link in a note — lands as a
  //   focused tab, so ONE effect here covers them all instead of a switch call
  //   at each call site. It fires on CHANGE only (the mount guard), so the
  //   persisted front survives launch and a by-hand switch is never undone. —
  const focusedTab = useFocusedTab();
  const focusedTabKey = focusedTab ? `${focusedTab.surfaceKind}:${focusedTab.id}` : null;
  const lastTabKey = useRef(focusedTabKey);
  useEffect(() => {
    if (focusedTabKey === lastTabKey.current) return;
    lastTabKey.current = focusedTabKey;
    if (!focusedTab) return;
    if (focusedTab.surfaceKind === "chat") setSidebarView("chat");
    else if (focusedTab.surfaceKind !== "activity") setSidebarView("home");
    // `focusedTab` is a fresh object each render — the string key is the dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedTabKey, setSidebarView]);
  const visibleSidebarView = sidebarFrontBody(sidebarView, contentView, dashboardSection);
  const pickSidebarView = (view: typeof sidebarView) => {
    setSidebarView(view);
    if (contentView === "dashboard") setDashboardSection(view === "chat" ? "models" : "rotli");
  };

  return (
    <aside
      className="sidebar"
      aria-label={sidebarMode === "breve" ? "Breve" : "Notes"}
      // suppress the WKWebView's default right-click menu ("Reload", …) inside the
      // sidebar; rotli's own row menus (board rename) handle contextmenu instead.
      // The editor keeps its native menu (spell-check / copy) — this is scoped here.
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* ONE header row (Seth, 2026-07-26): the vault switcher + the create
          icons share a line — less chrome before the content starts. Hidden in
          Breve mode — Breve is a mode over the same vault, not a different one. */}
      <div className={sidebarMode === "breve" ? "nl-top breve-active" : "nl-top"}>
        {sidebarMode !== "breve" && (
          <button
            type="button"
            className="vault-switch"
            aria-haspopup="menu"
            aria-label={`Vault: ${vaultName}. Switch or connect vaults`}
            title={`${vaultName} — switch or connect vaults`}
            onClick={openVaultMenu}
          >
            <VaultGlyph size={14.5} />
            <span className="vault-switch-name">{vaultName}</span>
            <span className="vault-switch-caret caret-down" aria-hidden="true">
              <ChevronRight size={9} />
            </span>
          </button>
        )}
        <button
          type="button"
          className={sidebarMode === "breve" ? "icobtn railon sb-breve-toggle" : "icobtn sb-breve-toggle"}
          aria-label={sidebarMode === "breve" ? "Back to Rotli home" : "Open Breve"}
          aria-pressed={sidebarMode === "breve"}
          data-hotkey="view.breve"
          onClick={() => dispatch("view.breve")}
        >
          {sidebarMode === "breve" ? <QuokkaMark size={17} /> : <CoffeeGlyph size={16} />}
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Back to Rotli" : "Breve"}
          </span>
        </button>
        <span className="nl-mode-sep" aria-hidden="true" />
        {/* IDE-style create icons (Seth #7/#13, 2026-07-03): the old "+" dropdown
            became explicit, always-visible actions — New… · New folder — mirroring
            VS Code's file-explorer title bar. Each targets the resolved (selected)
            folder. */}
        <button
          type="button"
          /* tb-trail right-anchors the tip inside the sidebar's overflow box —
             notes mode only: in Breve these buttons sit left-packed and a
             right-anchored tip would clip at the LEFT edge (review 2026-07-31) */
          className={sidebarMode === "breve" ? "icobtn" : "icobtn tb-trail"}
          aria-label={sidebarMode === "breve" ? "New is unavailable in Breve" : "New…"}
          disabled={sidebarMode === "breve"}
          onClick={openNewItemMenu}
        >
          <NewFileGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Unavailable in Breve" : "New…"}
          </span>
        </button>
        <button
          type="button"
          className={sidebarMode === "breve" ? "icobtn" : "icobtn tb-trail"}
          aria-label={
            sidebarMode === "breve"
              ? "New folder is unavailable in Breve"
              : visibleSidebarView === "chat"
                ? "New chat folder"
                : "New folder"
          }
          disabled={sidebarMode === "breve"}
          onClick={() => {
            // the System browser open? create a real folder at its cwd; else the
            // ACTIVE FRONT answers — Home opens its Main-folder input, Chat mints
            // a chat folder (the inline notes-tree input died with the 2026-07-26
            // System fold and left this button a silent no-op, P0)
            if (contentView === "system") requestSystemFolder();
            else requestSidebarFolder();
          }}
        >
          <NewFolderGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve"
              ? "Unavailable in Breve"
              : visibleSidebarView === "chat"
                ? "New chat folder"
                : "New folder"}
          </span>
        </button>
        {/* New board lives in the New… dropdown (Seth, 2026-07-28) — its own
            header icon was one too many for a narrow sidebar */}
        {/* collapse-all — TWO-STAGE (Seth, 2026-07-31): first press folds the
            open folders/trees, a second press folds the SYSTEM zone (the
            fronts replaced the Chat/Notes sections, 2026-08-01). Kept last,
            like the IDE. */}
        <button
          type="button"
          className={sidebarMode === "breve" ? "icobtn" : "icobtn tb-trail"}
          aria-label={
            sidebarMode === "breve" ? "Collapse all is unavailable in Breve" : "Collapse all folders"
          }
          disabled={sidebarMode === "breve"}
          /* default-OPEN rows (Main folders, CHAT folders) need an explicit
             false — wiping the map alone re-EXPANDED them (#83, audit 2026-07;
             chat folders were missed until 2026-07-31). "Brain" is NOT passed:
             nothing renders it as default-open anymore, and treating it as
             open made the first press a no-op on a fully-folded sidebar. */
          onClick={() => collapseAllDests([...mainFolderIds(activeTree), ...chats.folderKeys])}
        >
          <FoldGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Unavailable in Breve" : "Collapse all"}
          </span>
        </button>
      </div>

      {/* the FRONT switcher (Seth, 2026-08-01) — directly under the vault
          header, above everything the front renders. Breve is a MODE with its
          own navigation, so it replaces the switcher rather than nesting one. */}
      {sidebarMode !== "breve" && (
        <SidebarSwitcher
          value={sidebarFrontSelection(sidebarView, contentView)}
          onPick={pickSidebarView}
          chatCount={chats.chatList.length}
        />
      )}

      {/* a failed row-menu action (file-to-brain, board rename) says so HERE —
          inline, dismissible, above the tree it happened in (#11, audit 2026-07) */}
      {sidebarMode === "notes" && rowActionError && (
        <div className="sb-error" role="alert">
          <span className="sb-error-text">⚠ {rowActionError}</span>
          <button
            type="button"
            className="sb-error-x"
            aria-label="Dismiss"
            onClick={() => setRowActionError(null)}
          >
            ×
          </button>
        </div>
      )}

      {sidebarMode === "breve" ? (
        <BreveSidebar zoom={sidebarZoom} />
      ) : visibleSidebarView === "chat" ? (
        <SidebarChat chats={chats} zoom={sidebarZoom} />
      ) : (
        <SidebarHome zoom={sidebarZoom} chats={chats} />
      )}

      {/* the utility footer is APP-level, not front-level: it stays under Home
          and Chat alike (Seth, 2026-08-01: "the utility footer stays as is") */}
      {sidebarMode === "notes" && <SidebarFooter />}
    </aside>
  );
}
