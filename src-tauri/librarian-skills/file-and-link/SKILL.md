---
name: file-and-link
description: Propose where a note belongs (librarian_file) and which pages it should point to (librarian_link). Proposals only — the person approves them in Rotli.
---

# File and link

Both tools record a **proposal**. Nothing in the vault changes until the person
applies it (in Rotli, or `rotli librarian apply ID`).

## librarian_file {id, folder, reason}

- `folder` is a vault-relative folder that already exists or clearly should
  (`projects/payments`, `people/work`). Prefer the vault's existing folders;
  list them with `librarian_search` results' paths.
- `reason` is one sentence the person will read: "Meeting notes about the
  Payments launch; the rest of that project lives there."
- Don't propose filing secure or locked notes — you can't see them anyway.

## librarian_link {id, target, reason}

- Proposes adding one `[[target]]` wikilink to note `id` (under a
  `Related` line at its end). `target` is the exact title of an existing page.
- Link when a reader of `id` would want `target` next: same person, project,
  decision, or source. Don't link merely shared words.
- At most three link proposals per note per session.

Check `librarian_review` first so you never repeat a pending proposal.
