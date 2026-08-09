# Document architecture

Local documents follow Rotli's [clean architecture protocol](../../docs/architecture/clean-architecture.md):

`model + ports → workflow → OOXML/editor adapters → composition → UI hosts`

- `model.ts` owns framework-free document concepts and blank-document defaults.
- `ports.ts` defines encoder, local editor codec, reader/writer, and repository boundaries.
- `workflow.ts` contains dependency-injected create and edit use cases;
  `conversion.ts` owns the host-independent local conversion gate.
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
  Its narrow policy helper owns mutation classification and the insertion-range
  bridge needed when a portaled table dialog takes focus.
- `composition.ts` is the only module that joins concrete adapters to Tauri.
- `documentEditor.tsx` owns editor lifecycle, scoped ⌘S, dirty parking, and save
  status. `embedDocument.tsx` and `fileSurface.tsx` are hosts; neither parses or
  generates document bytes.
- `src-tauri/src/document_conversion.rs` is the single adapter for PDF text
  extraction and the fixed macOS `textutil` process. Corpus code supplies only
  guarded paths and owns managed-copy creation.

## Editing boundary

DOCX support is create + local structured editing. The portable subset currently
covers paragraphs, heading/title styles, alignment, lists, fonts, sizes, color,
common inline emphasis, and native Word tables with editable cell content and
row/column structure through Univer. Unsupported Word objects remain preserved
in their OOXML locations but are not editable; a one-time `.bak` protects the
original before the first Rotli save. Markdown-only features such as slash
commands and embed fences are never mounted in documents.

The editor presents conventional document defaults independent of the app
environment: white paper, black Arial text when the file does not specify a
style, one complete page fitted at initial open, and no canvas margin-corner
guides. Opening a modal must not discard the document insertion range. Only
content mutations make a session dirty; viewport zoom and scroll never do.

Legacy `.doc`, `.rtf`, and `.odt` files use an explicit macOS-local conversion
workflow. `/usr/bin/textutil` writes a temporary DOCX, Rotli validates the
package, and the corpus creates a new collision-safe managed copy while leaving
the original untouched. A PDF offers the same copy-to-DOCX action from its
viewer: a bundled pure-Rust adapter extracts embedded text offline by page,
`textutil` creates the editable DOCX, and Rotli opens that new managed copy.
This is intentionally a text-first import, not a claim of layout fidelity;
columns, tables, and complex positioning may need review. Image-only/scanned or
encrypted PDFs fail explicitly instead of producing an empty document and must
be OCRed or unlocked first. No account, network service, font download, or
in-place conversion is involved. `.dot`, `.pages`, and other legacy formats
remain unsupported when no faithful local conversion route is available.

Chat PDF generation is the reverse, copy-only lane: Rotli first creates a
normal editable Markdown source, then the fixed macOS `/usr/sbin/cupsfilter`
adapter exports a separate PDF into managed storage. The source remains the
editable truth; the PDF remains a viewer copy with the existing Convert to DOCX
escape hatch. The Rust boundary rejects secure, secret-shaped, or locked source,
read-only roots, invalid names, oversized output, and bytes without a PDF
signature. Neither file is replaced in place.

### PDF parser dependency review

`pdf-extract` 0.12.0 is a direct MIT-licensed Rust dependency used only inside
`document_conversion.rs`. It supplies the offline embedded-text capability that
PDFKit’s passive viewer does not expose to Rotli; it adds 28 locked transitive
packages, primarily `lopdf` plus font/encoding and symmetric-cipher support.
The parser handles untrusted local files, so the source is capped at 32 MB,
extracted text at 16 MB, panics are converted into visible failures, malformed
or textless input refuses conversion, and focused fixtures exercise page
boundaries plus a complete PDF → valid DOCX path. It has no network or provider
access. Path containment, read-only source handling, and managed-output gates
remain independent Rust corpus checks.

The Rust corpus allowlist remains an independent security boundary and must also opt
in to any newly generated or writable format. A future Google Docs connector should be a
separate provider adapter keyed by Drive file ID; it should not be folded into
the local OOXML codec or pretend that semantic HTML is the Google editor.
