# Document architecture

Local documents follow Rotli's [clean architecture protocol](../../docs/architecture/clean-architecture.md):

`model + ports → workflow → OOXML/editor adapters → composition → UI hosts`

- `model.ts` owns framework-free document concepts and blank-document defaults.
- `ports.ts` defines encoder, local editor codec, reader/writer, and repository boundaries.
- `workflow.ts` contains dependency-injected create and edit use cases.
- `kinds.ts` is the only frontend format-policy registry: extensions, local
  editing support, creation format, search keywords, byte cap, and native apps.
- `theme.ts` is the only generated-DOCX visual contract: Word font names,
  sizes, colors, page size, and margins.
- `create.ts` is a pure OOXML encoder. It knows no UI, corpus, or Tauri state.
- `codec/docx.ts` maps supported OOXML paragraphs and text styles to the clean
  document model. It edits `word/document.xml`, preserves unrelated package
  parts, and retains opaque body nodes such as tables.
- `engine/univer.ts` is the only document module that imports Univer. Replacing
  the editor does not change storage, the OOXML codec, or application use cases.
- `composition.ts` is the only module that joins concrete adapters to Tauri.
- `documentEditor.tsx` owns editor lifecycle, scoped ⌘S, dirty parking, and save
  status. `embedDocument.tsx` and `fileSurface.tsx` are hosts; neither parses or
  generates document bytes.

## Editing boundary

DOCX support is create + local structured editing. The portable subset currently
covers paragraphs, heading/title styles, alignment, lists, fonts, sizes, color,
and common inline emphasis. Tables and advanced Word objects remain inside the
saved OOXML package but are not yet editable; the UI reports that boundary and a
one-time `.bak` protects the original before the first Rotli save. Markdown-only
features such as slash commands and embed fences are never mounted in documents.

The Rust corpus allowlist remains an independent security boundary and must also opt
in to any newly generated or writable format. A future Google Docs connector should be a
separate provider adapter keyed by Drive file ID; it should not be folded into
the local OOXML codec or pretend that semantic HTML is the Google editor.
