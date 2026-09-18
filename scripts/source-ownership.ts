/** Explicit homes for source code. This is intentionally data, not directory
 * folklore: adding a new root or presentation cluster requires naming its
 * responsibility here and in the placement contract. */
export const SOURCE_DIRECTORY_OWNERS = {
  ai: "agent loop, model policy, prompts, tools, and provider-facing application logic",
  assets: "source-controlled application assets that are not part of the brand package",
  boards: "board capability, validation, sessions, and canvas-engine adapters",
  brand: "semantic visual policy, themes, typography, and provider marks",
  chatMemory: "per-chat memory domain, retrieval workflow, and composition",
  components: "React presentation and presentation-only feature clusters",
  documents: "editable document domain, workflows, codecs, engines, and composition",
  editor: "Markdown editor capability and its rendering/editing adapters",
  keys: "keybinding vocabulary, dispatch, chords, and keyboard interaction policy",
  lib: "cross-capability utilities and narrow host adapters; pure by default",
  memex: "portable vault contract plus frontend memex adapters and hooks",
  newItems: "cross-surface item-creation workflow and composition",
  noteChat: "note-linked chat model, transcript parsing, and session helpers",
  routines: "routine scheduling and watchlist domain policy",
  security: "frontend security policy independent from provider and presentation code",
  services: "effectful frontend application services and stateful command workflows",
  sheets: "editable spreadsheet capability, codecs, engines, and session",
  state: "Zustand stores and persistence registration",
  styles: "application CSS consuming semantic brand tokens",
  voice: "speech segmentation and text-to-speech adapter",
} as const;

export const SOURCE_ROOT_FILE_OWNERS = {
  "app.tsx": "application composition shell",
  "bunTest.d.ts": "Bun test type augmentation",
  "main.tsx": "browser/Tauri React entry point",
  "types.ts": "cross-presentation surface and pane vocabulary",
  "vite-env.d.ts": "Vite-generated environment declarations",
} as const;

export const COMPONENT_DIRECTORY_OWNERS = {
  breve: "Breve presentation feature",
  chat: "Chat pane presentation feature",
  onboarding: "first-run, vault activation, and model setup presentation",
  settings: "Settings pane sections and controls composed by settingsSurface (voice, connections, about)",
  sidebar: "sidebar presentation feature",
  system: "System browser (Library, Assets, Archive, Trash) rows composed by systemSurface",
  tour: "guided tour overlay that spotlights the real controls after setup",
} as const;

/** Root components are limited to pane/dialog entry points plus this explicit
 * list of shared primitives, overlays, and application-shell composition.
 * Feature-specific helpers belong in a named COMPONENT_DIRECTORY_OWNERS home. */
export const COMPONENT_ROOT_FILE_OWNERS = {
  "backToNotes.tsx": "shared back-to-panes control for full-content views",
  "webVaultConnectDialog.tsx": "Rotli Web: the connect-a-folder explanation before the browser's own picker",
  "webDialogFrame.tsx":
    "Rotli Web: the shared frame of its explanatory dialogs (overlay, card, Escape, actions)",
  "webChatSetupDialog.tsx": "Rotli Web: the chat-on-the-web walkthrough (helper, connect, sign in to a tool)",
  "captureCard.tsx": "application-shell quick-capture entry",
  "captureReveal.ts": "capture presentation state shared by shell surfaces",
  "character.tsx": "shared character renderer",
  "characterArt.ts": "shared lazy character-art registry",
  "contextMenu.tsx": "shared context-menu primitive",
  "documentEditor.tsx": "FileSurface document presentation adapter",
  "emptyState.tsx": "shared empty-state primitive",
  "fileNotice.tsx": "application-shell transient notice for Finder drops and pastes that landed out of sight",
  "glyphs.tsx": "shared first-party glyph registry",
  "hotkeyBadges.tsx": "shared shortcut badge overlay",
  "icon.tsx": "shared semantic icon primitive",
  "iconButton.tsx": "shared accessible icon-button primitive",
  "inlineRenameInput.tsx": "shared inline rename primitive",
  "matchText.tsx": "shared search-match renderer",
  "markdownPeek.tsx":
    "Static read-only Markdown peek shared by Quick Look and the Breve reader (one parseBlock + renderInline loop)",
  "antigravitySetup.tsx": "Antigravity lane setup card (Settings → AI Models install + Google sign-in)",
  "modelUsageSummary.ts": "shared model-usage presentation projection",
  "noteListRow.tsx": "shared note-list row",
  "palette.tsx": "application-shell command palette overlay",
  "paletteModel.ts": "command palette presentation projection",
  "paneTree.tsx": "application-shell pane composition",
  "remoteAgentsSection.tsx": "Settings → Connections remote-agent relay pairing (development builds only)",
  "welcomeSettings.tsx": "Settings Welcome folder action (seed the notes into Main, open the welcome note)",
  "previewModal.tsx": "shared media preview overlay",
  "quickNote.tsx": "application-shell auxiliary quick-note window",
  "sidebar.tsx": "sidebar feature entry point",
  "tabStrip.tsx": "application-shell tab composition",
  "titlebar.tsx": "application-shell titlebar composition",
  "useNoteMenu.ts": "shared note-action presentation hook",
  "whichKey.tsx": "application-shell held-modifier overlay",
} as const;

/** `src/lib` is inward/pure by default. These are the named cross-capability
 * shell and gesture adapters that legitimately depend on stores, services, or
 * Tauri. A new exception needs a responsibility here instead of quietly
 * turning lib into a general dumping ground. */
export const LIB_EFFECTFUL_FILE_OWNERS = {
  "clipboard.ts": "host pasteboard adapter (HTML copies with inlined image bytes)",
  "folderVaultStore.ts": "Rotli Web folder mode: .rotli/ files behind the vault-store port",
  "fsaVaultDir.ts": "Rotli Web folder mode: File System Access API behind the vault-dir port",
  "mainAddDrag.ts": "cross-surface Main drag workflow",
  "paneDropDrag.ts": "sidebar note → pane drop workflow",
  "nativeDrag.ts": "native Finder drag hover relay adapter",
  "popover.ts": "shared transient-popover hook backed by UI state",
  "quitFlush.ts": "native quit lifecycle adapter",
  "tabDrag.ts": "cross-surface tab drag workflow",
  "tauri.ts": "typed native-host adapter facade",
  "useNow.ts": "shared React wall-clock subscription for presentation projections",
} as const;

/** `src/services` is an application/effect boundary, not a miscellaneous
 * folder. Every production service declares the capability that owns it; when
 * one capability is physically clustered later, this registry moves with it. */
export const SERVICE_FILE_OWNERS = {
  "boardRename.ts": "boards",
  "brainFiling.ts": "librarian",
  "brainJournal.ts": "librarian",
  "brainJournalComposition.ts": "librarian",
  "brainJournalStore.ts": "librarian",
  "captureMerge.ts": "capture",
  "captureRouting.ts": "capture",
  "chatFolders.ts": "chat",
  "chatImages.ts": "chat",
  "chatModelMeta.ts": "chat",
  "chatRename.ts": "chat",
  "chatSummon.ts": "chat",
  "connectorSetup.ts": "chat",
  "helperLink.ts": "chat",
  "webAiCorpus.ts": "chat",
  "webChats.ts": "chat",
  "webFiles.ts": "notes",
  "createNote.ts": "notes",
  "demoCorpus.ts": "notes",
  "inMemoryNotes.ts": "notes",
  "derive.ts": "notes",
  "destinations.ts": "vault projection",
  "externalCorpusChange.ts": "vault lifecycle",
  "folderTrash.ts": "vault lifecycle",
  "fsNotes.ts": "notes adapter",
  "folderNotes.ts": "notes",
  "vaultDir.ts": "notes",
  "antigravity.ts": "connected-provider lane management (Antigravity runtime + sign-in)",
  "hooks.ts": "notes query adapter",
  "imageRepair.ts": "file storage",
  "itemLifecycle.ts": "vault lifecycle",
  "itemRename.ts": "vault lifecycle",
  "itemRenameComposition.ts": "vault lifecycle",
  "librarianAutoAdopt.ts": "librarian",
  "mainDismiss.ts": "Main projection",
  "mainTree.ts": "Main projection",
  "noteDrafts.ts": "note editor",
  "noteLifecycle.ts": "vault lifecycle",
  "notes.ts": "notes adapter",
  "remoteAgent.ts": "remote-agent relay adapter seam (development builds only)",
  "welcome.ts": "Welcome folder seeding and Main filing composition",
  "webNotes.ts": "notes",
  "webTasks.ts": "Tasks projection outside the Mac app (the corpus.rs twin)",
  "importedVault.ts": "notes",
  "webVaultFolder.ts": "notes",
  "notesPort.ts": "notes application port",
  "query.ts": "notes retrieval",
  "retentionPolicy.ts": "vault lifecycle",
  "search.ts": "notes retrieval",
  "secureReview.ts": "librarian security",
  "storageTree.ts": "file storage",
  "systemBrowser.ts": "system files",
  "macAppLink.ts": "system files",
  "systemNav.ts": "system files",
  "systemTrash.ts": "system files",
  "tasksView.ts": "tasks projection",
  "vaultSwitcher.ts": "vault lifecycle",
  "viewTree.ts": "named-view projection",
} as const;

type OwnershipSnapshot = {
  sourceDirectories: readonly string[];
  sourceRootFiles: readonly string[];
  componentDirectories: readonly string[];
  componentRootFiles: readonly string[];
  serviceFiles: readonly string[];
};

function setDifference(actual: ReadonlySet<string>, expected: ReadonlySet<string>): string[] {
  return [...actual].filter((value) => !expected.has(value)).sort((a, b) => a.localeCompare(b));
}

const isComponentEntryPoint = (file: string): boolean => /(?:Surface|Dialog)\.tsx$/.test(file);
const moduleStem = (file: string): string => file.replace(/(?:\.test)?\.tsx?$/, "");

export function sourceOwnershipViolations(snapshot: OwnershipSnapshot): string[] {
  const violations: string[] = [];
  const sourceDirectories = new Set(snapshot.sourceDirectories);
  const ownedSourceDirectories = new Set(Object.keys(SOURCE_DIRECTORY_OWNERS));
  for (const directory of setDifference(sourceDirectories, ownedSourceDirectories)) {
    violations.push(`src/${directory}: top-level source directory has no declared owner`);
  }
  for (const directory of setDifference(ownedSourceDirectories, sourceDirectories)) {
    violations.push(`src/${directory}: declared source owner is stale; directory is missing`);
  }

  const sourceRootFiles = new Set(snapshot.sourceRootFiles);
  const ownedSourceRootFiles = new Set(Object.keys(SOURCE_ROOT_FILE_OWNERS));
  for (const file of setDifference(sourceRootFiles, ownedSourceRootFiles)) {
    violations.push(
      `src/${file}: root source file has no declared owner; place it in a capability directory`,
    );
  }
  for (const file of setDifference(ownedSourceRootFiles, sourceRootFiles)) {
    violations.push(`src/${file}: declared root-file owner is stale; file is missing`);
  }

  const componentDirectories = new Set(snapshot.componentDirectories);
  const ownedComponentDirectories = new Set(Object.keys(COMPONENT_DIRECTORY_OWNERS));
  for (const directory of setDifference(componentDirectories, ownedComponentDirectories)) {
    violations.push(`src/components/${directory}: presentation feature directory has no declared owner`);
  }
  for (const directory of setDifference(ownedComponentDirectories, componentDirectories)) {
    violations.push(
      `src/components/${directory}: declared presentation owner is stale; directory is missing`,
    );
  }

  const componentRootFiles = new Set(snapshot.componentRootFiles);
  const productionFiles = new Set(snapshot.componentRootFiles.filter((file) => !/\.test\.tsx?$/.test(file)));
  const productionStems = new Set([...productionFiles].map(moduleStem));
  for (const file of productionFiles) {
    if (isComponentEntryPoint(file) || file in COMPONENT_ROOT_FILE_OWNERS) continue;
    violations.push(
      `src/components/${file}: feature-specific presentation belongs in a declared components/<feature>/ directory`,
    );
  }
  for (const file of snapshot.componentRootFiles.filter((candidate) => /\.test\.tsx?$/.test(candidate))) {
    const stem = moduleStem(file);
    if (!productionStems.has(stem)) {
      violations.push(
        `src/components/${file}: root test has no colocated production companion ${stem}.ts(x)`,
      );
    }
  }
  for (const file of Object.keys(COMPONENT_ROOT_FILE_OWNERS)) {
    if (!componentRootFiles.has(file)) {
      violations.push(`src/components/${file}: declared root-component owner is stale; file is missing`);
    }
  }

  const serviceFiles = new Set(snapshot.serviceFiles);
  const ownedServiceFiles = new Set(Object.keys(SERVICE_FILE_OWNERS));
  for (const file of setDifference(serviceFiles, ownedServiceFiles)) {
    violations.push(`src/services/${file}: application service has no declared capability owner`);
  }
  for (const file of setDifference(ownedServiceFiles, serviceFiles)) {
    violations.push(`src/services/${file}: declared service owner is stale; file is missing`);
  }

  return violations;
}
