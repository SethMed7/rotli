# Document architecture

Local documents follow Rotli's [clean architecture protocol](../../docs/architecture/clean-architecture.md):

`model + ports → workflow → create/preview adapters → composition → UI hosts`

- `model.ts` owns framework-free document concepts and blank-document defaults.
- `ports.ts` defines the encoder, previewer, reader, and repository boundaries.
- `workflow.ts` contains dependency-injected create and preview use cases.
- `kinds.ts` is the only frontend format-policy registry: extensions, local
  preview support, creation format, search keywords, byte cap, and native apps.
- `theme.ts` is the only generated-DOCX visual contract: Word font names,
  sizes, colors, page size, and margins.
- `create.ts` is a pure OOXML encoder. It knows no UI, corpus, or Tauri state.
- `preview.ts` is the replaceable local preview adapter. Mammoth currently
  produces safe semantic HTML; it deliberately does not promise Word layout.
- `composition.ts` is the only module that joins concrete adapters to Tauri.
- `DocumentPreview.tsx` owns async preview state. `embedDocument.tsx` and
  `fileSurface.tsx` are hosts; neither parses or generates document bytes.

The Rust corpus allowlist remains an independent security boundary and must also opt
in to any newly generated format. A future Google Docs connector should be a
separate provider adapter keyed by Drive file ID; it should not be folded into
the local OOXML codec or pretend that semantic HTML is the Google editor.
