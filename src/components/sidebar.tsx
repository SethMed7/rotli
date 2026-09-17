import { type MouseEvent, useEffect, useRef, useState } from "react";
// The sidebar SHELL. It owns the chrome that is true of every front — the vault
// header row, the create/collapse toolbar, the inline error lane, the front
// switcher, and the utility footer — then hands the body to whichever front is
// active (the maintainer's IA, 2026-08-01; docs/design/sidebar-home-chat.md):
//
//   Home  → src/components/sidebar/sidebarHome.tsx   (notes; System zone)
//   Chat  → src/components/sidebar/sidebarChat.tsx   (chats; folders)
//   Breve → src/components/breve/breveSidebar.tsx    (a MODE, not a front)
//
// The stacked "Chat ›" / "Notes ›" accordions are gone: each front owns the
// whole body and scrolls on its own, so nothing has to be folded to make room
// for anything else.

import { dispatch } from "../keys/registry";
import { isWebVault } from "../lib/browserVault";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { useTransientPopover } from "../lib/popover";
import { corpusInspectFolder, corpusRefreshVault } from "../lib/tauri";
import { type MemexInstance } from "../memex/config";
import { initMemexAsCorpus } from "../memex/service";
import { useConnectBrain, useForgetBrain, useMemexConfig, useSwitchVault } from "../memex/useMemex";
import { openNewItemMenu } from "../newItems/menu";
import { mainFolderIds } from "../services/mainTree";
import {
  vaultDisplayName,
  vaultOverflowItems,
  vaultRowLabel,
  vaultSwitcherItems,
} from "../services/vaultSwitcher";
import { activateCreatedVault, reconnectActiveVault } from "../state/activeVault";
import { useContextMenu } from "../state/contextMenu";
import { useFocusedTab } from "../state/panes";
import { useUiStore } from "../state/ui";
import { requestVaultFolder } from "../state/vaultFolderBrowser";
import { useWebVaultConnect } from "../state/webVaultConnect";
import { BreveSidebar } from "./breve/breveSidebar";
import { ChevronRight, MoreGlyph, NewFileGlyph, NewFolderGlyph, RefreshGlyph, VaultGlyph } from "./glyphs";
import { FolderReconnectBar } from "./sidebar/folderReconnectBar";
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

  // — the vault switcher: current + connected rows each own refresh/overflow;
  //   one Connect action handles existing and empty folders. —
  const memexCfg = useMemexConfig();
  const switchVaultMut = useSwitchVault();
  const connectBrainMut = useConnectBrain();
  const forgetBrainMut = useForgetBrain();
  const vaultName = vaultDisplayName(memexCfg.data?.instances ?? []);
  const vaultItems = vaultSwitcherItems(memexCfg.data?.instances ?? []);
  const vaultTriggerRef = useRef<HTMLButtonElement>(null);
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const [vaultMenuPosition, setVaultMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [refreshingVaultId, setRefreshingVaultId] = useState<string | null>(null);
  useTransientPopover([vaultTriggerRef, vaultMenuRef], !!vaultMenuPosition, () => setVaultMenuPosition(null));

  const vaultErr = (verb: string) => (err: unknown) =>
    setRowActionError(`Couldn’t ${verb} — ${err instanceof Error ? err.message : String(err)}`);

  const connectVault = async () => {
    if (isWebVault()) {
      // Rotli Web: say what is about to happen, then the browser's own picker
      useWebVaultConnect.getState().show();
      return;
    }
    const path = await requestVaultFolder({
      title: "Connect vault",
      description: "Choose an existing Rotli vault, or choose an empty folder to create one.",
      actionLabel: "Connect vault",
      requireEmpty: false,
    });
    if (!path) return;
    const report = await corpusInspectFolder(path);
    if (report.kind === "empty") {
      await initMemexAsCorpus(path);
      await activateCreatedVault();
      return;
    }
    if (report.kind !== "memex") {
      throw new Error("Choose an existing Rotli vault or an empty folder.");
    }
    await connectBrainMut.mutateAsync(path);
  };

  const refreshVault = async (id: string, active: boolean) => {
    if (refreshingVaultId) return;
    setRefreshingVaultId(id);
    try {
      if (active) await reconnectActiveVault();
      else await corpusRefreshVault(id);
    } finally {
      setRefreshingVaultId(null);
    }
  };

  const openVaultMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (vaultMenuPosition) {
      setVaultMenuPosition(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 16);
    setVaultMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: rect.bottom + 4,
    });
  };

  // Per-row overflow: Location settings, and the same "Remove from Rotli"
  // that lives in Settings → Location. Removal only disconnects — the folder
  // and its files stay where they are — and the active vault refuses (Rust's
  // forget_root rule), so switch first.
  const openVaultOverflow = (
    event: MouseEvent<HTMLButtonElement>,
    instance: MemexInstance,
    active: boolean,
  ) => {
    event.stopPropagation();
    const trigger = event.currentTarget;
    const rect = trigger.getBoundingClientRect();
    setVaultMenuPosition(null);
    openContextMenu(
      Math.max(8, rect.right - 202),
      rect.bottom + 4,
      vaultOverflowItems(instance, active, {
        openLocationSettings: () => dispatch("app.settings"),
        remove: () => void forgetBrainMut.mutateAsync(instance.id).catch(vaultErr("remove the vault")),
      }),
      { returnFocus: () => vaultTriggerRef.current?.focus() },
    );
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
    // Home/Chat are the way BACK from Breve too (2026-09-02): leave the mode
    // first — through the same guard the Breve action uses, so a dirty Breve
    // form still gets its confirm — and stay put if the person declines.
    const ui = useUiStore.getState();
    if (ui.sidebarMode === "breve") {
      ui.setSidebarMode("notes");
      if (useUiStore.getState().sidebarMode === "breve") return;
      ui.setContentView("panes");
    }
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
      {/* ONE header row: the active vault never disappears. Breve routines and
          notifications are owned by that vault, so hiding the switcher made
          the mode look detached from its durable home. Only the Coffee/Quokka
          mode mark changes; creation and tree controls remain stable. */}
      <div className={sidebarMode === "breve" ? "nl-top breve-active" : "nl-top"}>
        <button
          ref={vaultTriggerRef}
          type="button"
          className="vault-switch"
          aria-haspopup="menu"
          aria-expanded={!!vaultMenuPosition}
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
        {vaultMenuPosition && (
          <div
            ref={vaultMenuRef}
            className="vault-menu"
            role="menu"
            aria-label="Vaults"
            style={{ left: vaultMenuPosition.left, top: vaultMenuPosition.top }}
          >
            <div className="vault-menu-rows">
              {vaultItems.map(({ instance, active }) => {
                const label = vaultRowLabel(instance);
                const refreshing = refreshingVaultId === instance.id;
                return (
                  <div key={instance.id} className={active ? "vault-menu-row active" : "vault-menu-row"}>
                    <button
                      type="button"
                      className="vault-menu-target"
                      role="menuitem"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setVaultMenuPosition(null);
                        if (!active)
                          void switchVaultMut.mutateAsync(instance.id).catch(vaultErr("switch vaults"));
                      }}
                    >
                      <VaultGlyph size={15} />
                      <span>{label}</span>
                    </button>
                    <button
                      type="button"
                      className="vault-menu-row-action"
                      role="menuitem"
                      aria-label={`Refresh ${label}`}
                      title={`Refresh ${label}`}
                      disabled={!!refreshingVaultId}
                      onClick={() =>
                        void refreshVault(instance.id, active).catch(vaultErr("refresh the vault"))
                      }
                    >
                      <RefreshGlyph size={15} />
                    </button>
                    <button
                      type="button"
                      className="vault-menu-row-action"
                      role="menuitem"
                      aria-label={`More options for ${label}`}
                      title={`More options for ${label}`}
                      onClick={(event) => openVaultOverflow(event, instance, active)}
                    >
                      <MoreGlyph size={16} />
                    </button>
                    {refreshing && <span className="sr-only">Refreshing</span>}
                  </div>
                );
              })}
            </div>
            {vaultItems.length > 0 && <div className="vault-menu-separator" role="separator" />}
            <button
              type="button"
              className="vault-menu-connect"
              role="menuitem"
              onClick={() => {
                setVaultMenuPosition(null);
                void connectVault().catch(vaultErr("connect the vault"));
              }}
            >
              <NewFolderGlyph size={15} />
              <span>Connect vault</span>
            </button>
          </div>
        )}
        <span className="nl-mode-sep" aria-hidden="true" />
        {/* IDE-style create icons (the maintainer #7/#13, 2026-07-03): the old "+" dropdown
            became explicit, always-visible actions — New… · New folder — mirroring
            VS Code's file-explorer title bar. Each targets the resolved (selected)
            folder. */}
        <button
          type="button"
          /* tb-trail right-anchors the tip inside the sidebar's overflow box —
             notes mode only: in Breve these buttons sit left-packed and a
             right-anchored tip would clip at the LEFT edge (review 2026-07-31) */
          className="icobtn tb-trail"
          aria-label="New…"
          onClick={openNewItemMenu}
        >
          <NewFileGlyph size={16} />
          <span className="tip" aria-hidden="true">
            New…
          </span>
        </button>
        <button
          type="button"
          className="icobtn tb-trail"
          aria-label={visibleSidebarView === "chat" ? "New chat folder" : "New folder"}
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
            {visibleSidebarView === "chat" ? "New chat folder" : "New folder"}
          </span>
        </button>
        {/* New board lives in the New… dropdown (the maintainer, 2026-07-28) — its own
            header icon was one too many for a narrow sidebar */}
        {/* collapse-all — TWO-STAGE (the maintainer, 2026-07-31): first press folds the
            open folders/trees, a second press folds the SYSTEM zone (the
            fronts replaced the Chat/Notes sections, 2026-08-01). Kept last,
            like the IDE. */}
        <button
          type="button"
          className="icobtn tb-trail"
          aria-label="Collapse all folders"
          /* default-OPEN rows (Main folders, CHAT folders) need an explicit
             false — wiping the map alone re-EXPANDED them (#83, audit 2026-07;
             chat folders were missed until 2026-07-31). "Brain" is NOT passed:
             nothing renders it as default-open anymore, and treating it as
             open made the first press a no-op on a fully-folded sidebar. */
          onClick={() => collapseAllDests([...mainFolderIds(activeTree), ...chats.folderKeys])}
        >
          <FoldGlyph size={16} />
          <span className="tip" aria-hidden="true">
            Collapse all
          </span>
        </button>
      </div>

      {/* Rotli Web: the connected folder is waiting on the browser's permission
          — say so where it cannot be missed, above every front (2026-09-17) */}
      <FolderReconnectBar />
      {/* the FRONT switcher (the maintainer, 2026-08-01) — directly under the vault
          header, above everything the front renders. Breve is a MODE with its
          own rail below, but it sits in the same control (2026-09-02) so the
          way in and the way back are the same labelled segments. */}
      <SidebarSwitcher
        value={sidebarMode === "breve" ? null : sidebarFrontSelection(sidebarView, contentView)}
        onPick={pickSidebarView}
        chatCount={chats.chatList.length}
        breveActive={sidebarMode === "breve"}
        onBreve={LAUNCH_FEATURES.breve ? () => dispatch("view.breve") : undefined}
      />

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

      {/* the utility footer is APP-level, not front-level: it stays under Home,
          Chat, and Breve alike (the maintainer, 2026-08-01: "the utility footer
          stays as is"; Breve joined 2026-09-02 so Settings and the Librarian
          never vanish while reading a brief) */}
      <SidebarFooter />
    </aside>
  );
}
