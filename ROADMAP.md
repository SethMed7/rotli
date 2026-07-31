# Roadmap

Planned features — direction, not commitment. Order within a section is rough
priority; nothing here has a date. What's already built lives in
[README.md](README.md); how things get built lives in [AGENTS.md](AGENTS.md)
and [docs/](docs/README.md).

## Inbox — a calm layer over your own email

The third front. The sidebar once carried a placeholder Inbox section
(account → thread structure, disabled); it was removed on 2026-07-30 so the
shell only shows what works. It returns when the mail integration is real.

- Connect your own accounts; rotli reads and organizes, never hosts.
- Threads become linkable objects in the memex — an email can be referenced
  from a note the way notes reference each other.
- Same calm rules as the rest of the shell: no badges, no unread anxiety.
- Restore blueprint for the sidebar section:
  [docs/archive/notes-chat-inbox-rearchitecture.md](docs/archive/notes-chat-inbox-rearchitecture.md)
  (the `sec:inbox` expansion key is still honored by the persistence layer).

## Mobile app

rotli on iPhone. The vault stays the source of truth — plain files, synced by
whatever the user already trusts (iCloud Drive, Syncthing, git). Capture-first:
the phone is primarily a way in (quick capture, voice, photos into Assets),
with a readable library second and editing third.

## Tablet app

rotli on iPad. Same vault, bigger canvas: reading, reviewing, and boards.
Pencil input pairs with the notebook experience below.

## Handwriting → text: the full notebook experience

Write by hand, keep real notes. A notebook surface where handwritten pages
(Pencil on iPad, imported scans on Mac) are recognized on-device into Markdown
that lands in the same memex — the handwriting stays as the artifact, the text
becomes searchable, linkable, and organizable by the Librarian.

- On-device recognition only — handwriting never leaves the machine.
- Pages are assets; recognized text is a note linked to its page.
- Boards and notebooks converge: sketch, write, and type on one surface.

## Publish to Substack — waiting on the official channel

A note-level verb, not a surface: write in rotli's calm, clutter-free editor,
then publish straight to Substack — no browser tab, no editor noise, no
distraction between finishing a piece and shipping it. That's the whole point:
rotli stays the clean place to write and think; Substack is just where it lands.

**Deliberately parked (decided 2026-07-31).** Substack has no official publish
API; every existing route is reverse-engineered private endpoints or browser
automation — hacky, fragile, and against the spirit of their ToS, so we don't
build on it. The official story is moving our way: Substack shipped a read-only
analytics MCP on 2026-07-07 (`mcp.substack.com`, Bestseller publications only),
and CEO Chris Best has said publicly that MCP write/act capabilities are coming.
When the official write channel ships, this feature lights up through it.

- Trigger: Substack's official MCP gains write/publish (watchlisted in Breve;
  follow @chrisbest for the announcement).
- Design already sketched: publish is a ⋯-menu/palette verb; draft-first (never
  auto-publish); credentials in Keychain; `secure:` notes blocked by the
  existing remote gate; state in `.rotli/`, never frontmatter; built behind a
  provider abstraction so Ghost/Buttondown (real, stable APIs) can follow.
- Interim option if wanted sooner: "Copy for Substack" (rich-HTML clipboard) —
  touches no endpoints, can't break, zero ToS exposure.

## Returning ideas parked earlier

- **Feature A — secure organization** (needs its own session with injection
  evals before any build).
- **Calendar integration** — cal.diy base; Apple + Google + Proton providers.
