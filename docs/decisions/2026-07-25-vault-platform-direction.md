# Direction: the vault platform — memex folds into rotli

Date: 2026-07-25 · Status: **direction set by Seth; sidebar affordance changes
shipped; the platform items below are proposed scope, each needing its own
implementation review**

Source: Seth's review of Zen Notes (screenshots, 2026-07-25). Not a copy — a
short list of things it gets right that rotli should own in its own voice.

## Decided and shipped now (sidebar affordances)

- **Create affordances are always visible, never hover-revealed.** The per-folder
  new-note/new-folder pair and the Main-header new-folder mark render at ~55%
  strength permanently, full strength on hover/focus. "The icons are always
  there… it's just cleaner."
- **System rows carry no create affordances.** Storage, Archive, Trash, and
  Secure notes are system surfaces; the add pair lives on user folder rows and
  the toolbar covers everything else.

## 1. Memex becomes rotli's vault layer (the big one)

Seth: the vault should be *just data*; rotli is the layer on top that manages
and understands it. The separate public `memex` repo/brand retires — the format
lives wherever rotli names it.

What this means concretely (proposed):

- The file contract (`memex.json`, contract band, lanes, frontmatter grammar)
  becomes a rotli-owned specification — likely `docs/architecture/` plus an
  in-app/exported reference — instead of pointing at an external template repo.
- Nothing about the data model changes: one folder is one vault, plain files
  are durable truth, `.rotli/` stays a rebuildable projection. This is a
  naming/ownership consolidation, not a format change.
- Open questions for the implementing session: what the format is publicly
  called ("rotli vault" vs keeping "memex" as the internal term), migration of
  cross-repo references (memex-vault instance tooling, Breve's pointer,
  CLAUDE.md guidance), and what happens to the public `SethMed7/memex` repo.
  **Archiving/retiring that repo is an external, hard-to-reverse operation that
  stays Seth's explicit call** — this document does not authorize it.

## 2. Vault switcher in the sidebar header

Zen's vault menu (Close Current Vault · Add Local Vault · Connect Remote ·
Open in New Window) maps cleanly onto machinery rotli already has: the unified
`corpus.json` (one active brain + connected linked libraries) and the Location
settings pane. The missing piece is the *surface*: the sidebar identity/header
becomes a vault menu — switch active vault, add a local folder, open the
Location pane for the rest. Constraint: switching the active memex currently
relaunches; the switcher should say so honestly rather than pretend it's
instant.

## 3. Tasks as a first-class quick-access surface

A Tasks row in Quick access aggregating `[ ]` checkboxes across notes (Markdown
stays the source of truth; the surface is a projection, like Main). Needs its
own design: scope (open tasks only? per-note grouping? due-ness?), and how it
respects secure/locked notes (secure note tasks never leave the device and
never surface to remote models).

## 4. Assets as the system home for binaries

Zen's "Assets" row = rotli's existing managed `storage/` lane, surfaced as a
clean system row (count, grouped viewer) rather than a folder tree users are
invited to organize by hand. Direction: present Storage as **Assets** — one
place for every image/video/PDF/file — with the existing Type/Date/Folder
grouping as its internal view. Folder-tree editing affordances go away from the
system area (already shipped above); whether user subfolders under the lane
survive at all is the design question.

## Sequencing

1. (shipped 2026-07-25) sidebar affordance cleanup.
2. (shipped 2026-07-25) vault switcher — the sidebar header names the current
   vault; the menu switches (honest about the relaunch), connects, or opens
   Location settings.
3. (shipped 2026-07-25) Assets presentation pass — the storage lane displays as
   **Assets** everywhere; ids and the on-disk `storage/` lane keep their names.
4. (shipped 2026-07-25) Tasks v1 — see
   [`2026-07-25-tasks-surface.md`](2026-07-25-tasks-surface.md).
5. Memex→rotli consolidation — the in-repo step landed 2026-07-25 (the README
   no longer points at the external template repo; the vault format speaks in
   rotli's own voice). The external steps — archiving `SethMed7/memex`,
   migrating memex-vault tooling references, CLAUDE.md guidance — remain
   Seth's explicit call and are untouched.
