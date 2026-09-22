// The data seam. All note/folder access goes through this typed interface,
// and the bottom of this file is the ONE switch point: inside the Tauri shell
// the markdown corpus on disk is the truth (FsNotesService); in a plain
// browser (vite dev, design review) the seeded in-memory service remains.
// Components never call either directly — they consume the TanStack Query
// hooks in ./hooks.ts.

import { browserVault, isWebVault } from "../lib/browserVault";
import { isTauri } from "../lib/tauri";
import { registerWebAiCorpus, registerWebFileStore, registerWebMemexBridge } from "../lib/webAiSeam";
import { showFileNotice } from "../state/fileNotice";
import { useHelperLink } from "../state/helperLink";
import { seedDemoCorpus, seedReservedRoots } from "./demoCorpus";
import { FsNotesService } from "./fsNotes";
import { adoptPairingFromUrl, hydrateHelperLink } from "./helperLink";
import { InMemoryNotesService } from "./inMemoryNotes";
import type { NotesService } from "./notesPort";
import { createWebAiCorpus } from "./webAiCorpus";
import { chatStoreFor, webMemexBridge } from "./webChats";
import { createWebFileStore } from "./webFiles";
import {
  activeWebNotesService,
  activeWebVaultDir,
  hydrateWebNotes,
  webVaultIsFreshFolder,
  webVaultKey,
} from "./webNotes";
import { journalKey, replayJournal } from "./webUnsavedJournal";

export { InMemoryNotesService, ulid } from "./inMemoryNotes";

/** ONE switch point — decided once, at startup. */
const FS_MODE = isTauri();
/** Rotli Web: the in-memory service, persisted to the browser vault. The
 * demo corpus below never seeds here — a fresh web vault starts like a fresh
 * Mac vault (reserved roots + the Welcome folder), and a returning visit
 * restores the snapshot before the first render (hydrateWebNotes). */
const WEB_MODE = !FS_MODE && isWebVault();

// Dev-only review affordance: ?empty skips note seeding so the r1 frame E
// empty state ("Your island is ready") can be looked at. Folders still exist —
// Inbox is the capture target either way.
const SEED_EMPTY =
  import.meta.env.DEV &&
  ["empty", "onboarding"].some((key) => new URLSearchParams(window.location.search).has(key));

const svc = new InMemoryNotesService();

// fs mode: folder ids ARE relative paths; "Inbox" is born on first run
let inboxId = "Inbox";
let firstNoteId = "";

if (!FS_MODE && !WEB_MODE) {
  const seeded = seedDemoCorpus(svc, SEED_EMPTY);
  inboxId = seeded.inboxId;
  firstNoteId = seeded.firstNoteId;
} else if (WEB_MODE) {
  // A fresh web vault starts like a fresh Mac vault: the reserved roots and
  // nothing else. A returning visit restores its snapshot before the first
  // render (hydrateWebNotes in ./webNotes.ts).
  inboxId = seedReservedRoots(svc);
}

export { activeWebVaultDir, webVaultIsFreshFolder };

/** Where captures and ⌘N land when no folder is selected — "Inbox" on disk
 * (fs mode), the seeded folder's id in the browser. */
export const inboxFolderId = inboxId;

/** The note the window opens on (gate frame A); "" when nothing is known at
 * startup — fs mode resolves the freshest note async (App.tsx fills the
 * pristine first tab once the corpus answers). */
export const initialNoteId = firstNoteId;

// A `let`, not a `const`: Rotli Web retargets it at boot when the browser
// still trusts a remembered folder (hydrateWebVault, before the first render).
// Consumers read the live binding at call time, never a captured copy.
export let notesService: NotesService = FS_MODE ? new FsNotesService() : svc;

/** Rotli Web only: connect the bound vault before the first render (main.tsx
 * awaits it). The helper pairing comes first — a vault served by Rotli Helper
 * needs it. Resolves true when a vault is connected; false means setup. */
export async function hydrateWebVault(): Promise<boolean> {
  if (!WEB_MODE) return false;
  await hydrateHelperLink();
  await adoptPairingFromUrl(); // the installer's `#pair=` handoff, if this tab carries one
  const connected = await hydrateWebNotes(useHelperLink.getState().link);
  notesService = activeWebNotesService(notesService);
  const vault = webVaultKey();
  if (connected && vault && typeof window !== "undefined") {
    // typing the last page couldn't save before it unloaded
    const { keptAside } = await replayJournal(window.localStorage, journalKey(vault), notesService);
    if (keptAside.length > 0) {
      showFileNotice(`Kept unsaved edits beside the changed note: “${keptAside.join("”, “")}”`);
    }
  }
  // the model's view of this vault, and the helper that runs the model
  registerWebAiCorpus(createWebAiCorpus(() => notesService));
  registerWebMemexBridge(webMemexBridge(chatStoreFor(activeWebVaultDir())));
  registerWebFileStore(createWebFileStore(activeWebVaultDir(), browserVault));
  return connected;
}
