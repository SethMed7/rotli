# Document architecture

Local documents follow Rotli's [clean architecture protocol](../../docs/architecture/clean-architecture.md):

`model + ports → workflow → OOXML/editor adapters → composition → UI hosts`

- `model.ts` owns framework-free document concepts and blank-document defaults.
- `ports.ts` defines encoder, local editor codec, reader/writer, and repository boundaries.
- `workflow.ts` contains dependency-injected create and edit use cases;
  `conversion.ts` owns the host-independent legacy conversion gate.
- `kinds.ts` is the only frontend format-policy registry: extensions, local
  editing support, creation format, search keywords, byte cap, and native apps.
- `theme.ts` is the only generated-DOCX visual contract: Word font names,
  sizes, colors, page size, and margins.
- `create.ts` is a pure OOXML encoder. It knows no UI, corpus, or Tauri state.
- `codec/docx.ts` maps supported OOXML paragraphs, text styles, and tables to
  the clean document model. It patches `word/document.xml`, preserves unrelated
  package parts, and retains unsupported objects inside edited paragraphs and
  table cells.
- `engine/univer.ts` is the only document module that imports Univer. Replacing
  the editor does not change storage, the OOXML codec, or application use cases.
- `composition.ts` is the only module that joins concrete adapters to Tauri.
- `documentEditor.tsx` owns editor lifecycle, scoped ⌘S, dirty parking, and save
  status. `embedDocument.tsx` and `fileSurface.tsx` are hosts; neither parses or
  generates document bytes.

## Editing boundary

DOCX support is create + local structured editing. The portable subset currently
covers paragraphs, heading/title styles, alignment, lists, fonts, sizes, color,
common inline emphasis, and native Word tables with editable cell content and
row/column structure through Univer. Unsupported Word objects remain preserved
in their OOXML locations but are not editable; a one-time `.bak` protects the
original before the first Rotli save. Markdown-only features such as slash
commands and embed fences are never mounted in documents.

Legacy `.doc`, `.rtf`, and `.odt` files use an explicit macOS-local conversion
workflow. `/usr/bin/textutil` writes a temporary DOCX, Rotli validates the
package, and the corpus creates a new collision-safe managed copy while leaving
the original untouched. No account, network service, or in-place conversion is
involved. `.dot`, `.pages`, and other legacy formats remain unsupported when no
faithful local conversion route is available.

The Rust corpus allowlist remains an independent security boundary and must also opt
in to any newly generated or writable format. A future Google Docs connector should be a
separate provider adapter keyed by Drive file ID; it should not be folded into
the local OOXML codec or pretend that semantic HTML is the Google editor.
