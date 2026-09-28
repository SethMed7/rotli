---
name: split-along-a-seam
description: What to do when a structural gate refuses a change — a file over its size ceiling, the duplication gate over its cluster count, presentation reaching the Tauri adapter, a new React Compiler or design-system diagnostic. Use the moment `check:ratchets`, `check:dup:gate`, `check:architecture`, `check:react-compiler`, `check:design-system`, or `check:hex` fails.
---

# Split along a seam

These gates only move one way. Never raise a ceiling, allowlist a cluster, or
extend a debt list to get green; find the seam the gate is pointing at.

## A file over its size ceiling (`bun run check:ratchets`)

- The ceilings live in `scripts/ratchet-baseline.json`; the count is `wc -l`
  plus one. A new file of 600+ lines needs a ceiling too.
- Move a coherent block that already has one job into its own module and
  re-export it from the old file so no importer changes. Good seams from
  2026-09-27: pure tree walks (`src/state/paneTree.ts`), chat-map key rules
  (`src/state/chatMapKeys.ts`), sidebar enums (`src/state/sidebarPlacement.ts`),
  a surface's artifact rows (`src/components/chat/chatArtifactItems.tsx`).
- A test file near its ceiling: put the new tests in a new file named for
  the behavior, not in the old one.

## The duplication gate (`bun run check:dup:gate`)

- It has no headroom. Find what you added with
  `node scripts/check-duplication.mjs --all --out /tmp/now.json`, run the
  same in a clean worktree of `origin/dev`, and compare clusters by their
  member files (cluster ids are content hashes and shift when code moves).
- Test literals count: two test files sharing sample strings form a
  cluster. Use different sample text rather than an allowlist entry.
- Two dialogs repeating the modal markup: reuse the shared frame
  (`src/components/webDialogFrame.tsx`).

## Presentation reaching `lib/tauri` (`bun run check:architecture`)

- A component may not import `src/lib/tauri.ts`. Route the call through a
  `src/services/` function (the shape of `src/services/chatImages.ts`), or for
  a platform switch use `PLATFORM` from `src/lib/featurePolicy.ts`.
- A new service file needs its owner in `scripts/source-ownership.ts`.

## React Compiler (`bun run check:react-compiler`)

- `EffectSetState`: don't reset state inside an effect; key the child by
  the thing that changed so it mounts fresh.
- `Immutability`: never assign to something a hook returned (`x.ref.current =`);
  have the hook return a callback that does it.
- `Suppression`: no `eslint-disable` for hook deps; list the real deps.

## Design system and color (`bun run check:design-system`, `bun run check:hex`)

- No `box-shadow`, glows, filters, or backdrop blur: use an outline or a border.
- Hex and functional colors only in `src/brand/` and `src/styles/themes.css`;
  a test needing a color either imports a constant from `src/brand/` or uses
  a named color.
