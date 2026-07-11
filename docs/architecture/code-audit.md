# Code organization audit — 2026-07-11

## Outcome

The new item, document, memex-map, and organizer-model work follows the enforced
dependency direction. The repository now mechanically checks camelCase source
filenames, denied database dependencies, bundled Breve dependency parity,
domain/application imports, the Tauri adapter boundary, frontend/Rust IPC
parity, and the Markdown-only slash boundary.

## Stable seams

- `src/newItems/`: item vocabulary, framework-free workflow, composition root,
  and menu adapter. Hotkeys, titlebar, sidebar, tab strip, and slash creation
  converge here.
- `src/documents/`: document domain, ports, create/edit use cases, package-
  preserving DOCX codec, replaceable editor adapter, and one composition root.
- `src/memex/modelMap.ts`: pure capability/priority projection consumed by the
  AI host; no storage or presentation dependencies.
- `src/chatMemory/`: deterministic per-chat memory notes, master keyword
  retrieval, framework-free workflow, and one Tauri/memex composition root.
- `src/ai/budget.ts`: capability-derived retrieval budgets.
- Rust corpus and provider modules remain independent security boundaries.

## Verified data rules

- No database dependency or browser storage API is present.
- Main stores references, not content.
- New Markdown, document, sheet, and board creation resolves one physical home
  and one Main reference through a common sequence.
- Metadata ownership is disjoint across Rotli, the user, and the Brain filer.
- Slash commands are mounted by the Markdown editor only.
- Master RAG searches organized notes and original chats, then reads only the
  selected source; every newly persisted chat maintains one linked memory note.
- Gemini 3.5 uses the existing authenticated remote-provider guardrails; secure
  and locked notes are filtered before transport.

## Remaining decomposition targets

These are maintainability hotspots, not blockers for this workflow:

1. `settingsSurface.tsx` contains several independent panes. Extract each pane
   into a `settings/` presentation module while keeping shared controls local to
   that feature.
2. `sidebar.tsx` combines tree projection, gestures, row actions, and rendering.
   Split by visible section after adding interaction tests for each section.
3. `breveSurface.tsx` should become one presentation module per Breve page,
   retaining the existing shared Breve model and form primitives.
4. `lib/tauri.ts` is a broad IPC façade. Split it by capability (corpus,
   provider, Breve, shell) without changing command names or Rust validation.

The full system-level findings and recommended order are in
[`system-audit-2026-07-11.md`](./system-audit-2026-07-11.md).

These should be incremental refactors. File size alone is not a reason to add
generic abstractions; each extraction should reduce one real responsibility and
ship with its behavior tests.
