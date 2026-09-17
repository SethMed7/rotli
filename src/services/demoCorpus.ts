// The browser twin's sample corpus — `vite dev`, the Playwright lane, and the
// site captures. Inside the Tauri shell the demo never exists in memory (the
// disk corpus is the truth) and Rotli Web starts from the reserved roots
// alone (see ./notes.ts). Titles and snippets come from the approved gate
// frames.

import { DEST } from "./destinations";
import { InMemoryNotesService } from "./inMemoryNotes";

/** The reserved LOCAL roots: id === name (mirrors fs mode where folderId is the
 * path), so DEST.inbox === folder.id holds off-disk too. Returns the Inbox id. */
export function seedReservedRoots(svc: InMemoryNotesService): string {
  const inbox = svc.seedReserved(DEST.inbox, DEST.inbox);
  svc.seedReserved(DEST.secure, DEST.secure);
  svc.seedReserved(DEST.storage, DEST.storage);
  svc.seedReserved(DEST.board, DEST.board);
  svc.seedReserved(DEST.archive, DEST.archive);
  svc.seedReserved(DEST.trash, DEST.trash);
  return inbox.id;
}

/** Seed the twin's folders and (unless `empty`) its sample notes. Returns the
 * Inbox id and the note the window opens on ("" when nothing was seeded). */
export function seedDemoCorpus(
  svc: InMemoryNotesService,
  empty: boolean,
): { inboxId: string; firstNoteId: string } {
  let firstNoteId = "";
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const todayAt = (h: number, m: number) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return Math.min(d.getTime(), now);
  };

  const inboxId = seedReservedRoots(svc);
  const inbox = { id: inboxId };

  // The external Vault root (mirrors fs mode's memex auto-bind to ~/memex-vault): a
  // non-default root whose surfaced folders carry the "vault:" prefix. Only
  // wiki/ (browse-only) + chats/ surface — identity/personality/history/etc never do. The Vault
  // row itself is the marker DEST.vault ("vault:"); these are its top-level
  // folders (parentId === null, exactly as Rust aggregates them).
  svc.seedReserved("vault:wiki", "wiki", null);
  svc.seedReserved("vault:chats", "chats", null);
  // A nested wiki subfolder so the tree + descendant scoping render like fs mode.
  const vaultProjects = svc.seedReserved("vault:wiki/projects", "projects", "vault:wiki");

  // The corpus's OWN Library (wiki/) — mirrors fs mode, where the Librarian
  // files notes into areas. One filed note (below) + one EMPTY area, so the
  // System browser's Finder truths hold in the browser fixture too: empty
  // folders render, and "Show in Library" lands on the exact folder.
  svc.seedReserved("wiki", "wiki", null);
  const wikiProjects = svc.seedReserved("wiki/Projects", "Projects", "wiki");
  svc.seedReserved("wiki/People", "People", "wiki");

  // A couple of LOCAL user folders under Storage — path-style ids so the tree
  // renders and descendant scoping behaves exactly like fs mode.
  const storageWork = svc.seedReserved(`${DEST.storage}/Work`, "Work", DEST.storage);
  const storageNorthstar = svc.seedReserved(`${DEST.storage}/Northstar`, "Northstar", DEST.storage);

  if (!empty) {
    // one transcript, so the Library's Chats folder has something to show (the
    // Chat front lists chats through the memex bridge, which the twin lacks)
    svc.seedNote(
      "vault:chats",
      "# Planning chat\n\n## Messages\n\n**you** · 2026-09-10T10:00:00Z — where do we start?\n",
      {
        createdAt: Date.parse("2026-09-10"),
        updatedAt: Date.parse("2026-09-10"),
      },
    );
    // —— Inbox: the welcome note + a quick capture ——
    const welcome = svc.seedNote(
      inbox.id,
      `# rotli — notes first

Apple Notes feel, **markdown underneath**. Local files, one structure the AI can read. The app is a *visitor* — summon it, write, dismiss it.

### What ships first

- [x] Folders, list, editor — the three panes
- [ ] Quick capture from anywhere (\`⌥Space\`)
- [ ] Plain \`.md\` files on disk — the corpus

> The folder of files *is* the product. Every view, every backend, every AI is a reader.

Start with a note. Add context when a conversation would help. Your files stay yours.`,
      { createdAt: todayAt(9, 42), updatedAt: todayAt(9, 42) },
    );
    firstNoteId = welcome.id;

    svc.seedNote(inbox.id, `# Call the bank about the wire limit before Friday`, {
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY,
    });

    // —— Storage: a pinned decision + nested Work/Northstar notes ——
    svc.seedNote(
      DEST.storage,
      `# Pricing decision

Free local forever. Paid = sync + managed AI. Never gate local features behind the subscription — the corpus is the user's, full stop.

Launch sync at $4, anchor on Obsidian, revisit at 10k users.`,
      { pinned: true, createdAt: todayAt(8, 5), updatedAt: todayAt(9, 10) },
    );

    svc.seedNote(
      storageWork.id,
      `# Q3 platform review — prep

Three things must land before Thursday: the settlement mapping, the gateway export enum, and a clear pricing answer we can defend in front of the partners.

The demo flows from capture → recall: open with the island story, close with the cited answer.

Maria owns the reconciliation walkthrough; I take pricing.`,
      { createdAt: now - DAY, updatedAt: now - DAY },
    );

    svc.seedNote(
      storageNorthstar.id,
      `# Q3 priorities — Northstar

Ship the gateway migration, land the issuing portal rebuild, and get the partner reporting story straight before the platform review.`,
      { createdAt: todayAt(7, 30), updatedAt: todayAt(7, 30) },
    );

    // —— Vault (external memex, browse-only): wiki/ notes that rotli reads but
    // never writes. These mirror what surfaces from ~/memex-vault — note-creation is
    // redirected to the local Inbox, never into here. ——
    svc.seedNote(
      "vault:wiki",
      `# memex-vault — the knowledge base

The durable, human-readable memory. rotli browses it read-only: wiki/ surfaces here, identity/, personality/ and history/ never do.`,
      { createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY },
    );

    svc.seedNote(
      vaultProjects.id,
      `# rotli — project note

The warm, local-first menu-bar notes app. Lives in its own repo; the Vault is where its long-form thinking is kept.`,
      { createdAt: now - 5 * DAY, updatedAt: now - 5 * DAY },
    );

    // —— a plain local "Brain" folder: the Brain→Vault rename leaves the
    // pre-existing local folder untouched (Invariant 4) — it's just a folder now.
    const localBrain = svc.seedFolder("Brain");

    // —— Storage: long-lived reference ——
    svc.seedNote(
      DEST.storage,
      `# Quokka world — where it lives

Onboarding, empty states, about. Never in the editor, never in notifications — the world appears at low-frequency moments only.`,
      { createdAt: now - DAY, updatedAt: now - DAY },
    );

    svc.seedNote(
      DEST.storage,
      `# Groceries

Olive oil, sourdough, oat milk, blueberries, the good butter.`,
      { createdAt: now - 4 * DAY, updatedAt: now - 4 * DAY },
    );

    // —— ONE Archive note + ONE Trash note (origin = where restore returns it).
    // These are hidden from All Notes; only their own view shows them. ——
    svc.seedNote(
      DEST.archive,
      `# 1-on-1 — Sarah

Ship review Friday. She'll own the gateway migration writeup. Follow up on the Lithic question and the Q3 growth path conversation.`,
      {
        createdAt: now - 30 * DAY,
        updatedAt: now - 7 * DAY,
        origin: `${DEST.storage}/Work`,
      },
    );

    svc.seedNote(
      DEST.trash,
      `# Old draft — pricing tiers v0

Scrap this. The three-tier idea died; we went free-local + one paid sync line. Kept only so Phase 2 restore has something to put back.`,
      {
        createdAt: now - 14 * DAY,
        updatedAt: now - 5 * DAY,
        origin: localBrain.id,
      },
    );

    // —— Library: a note the Librarian filed into an area (wiki/Projects) ——
    svc.seedNote(
      wikiProjects.id,
      `# Launch checklist

Filed under **Projects** by the Librarian — same file, reachable from Main and the Library alike.`,
      { createdAt: now - 2 * DAY, updatedAt: now - DAY },
    );

    // —— Board: loose quick-captures, the staging area. Cards, not notes — you
    // multi-select and merge them into one joint note (the maintainer, 2026-06-19). ——
    svc.seedNote(DEST.board, "Ask Maria about the settlement mapping deadline", {
      createdAt: now - 40 * 60 * 1000,
      updatedAt: now - 40 * 60 * 1000,
    });
    svc.seedNote(DEST.board, "Idea: warm empty-state for the Board — the quokka again?", {
      createdAt: now - 25 * 60 * 1000,
      updatedAt: now - 25 * 60 * 1000,
    });
    svc.seedNote(DEST.board, "Gateway export enum — confirm the Lithic mapping before Thursday", {
      createdAt: now - 8 * 60 * 1000,
      updatedAt: now - 8 * 60 * 1000,
    });
  }
  return { inboxId: inbox.id, firstNoteId };
}
