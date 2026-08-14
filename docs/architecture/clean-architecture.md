# Rotli clean architecture protocol

Rotli organizes code around product capabilities, with dependencies pointing
inward toward stable business rules:

`domain → application → adapters → composition → presentation`

## Layer responsibilities

- **Domain** contains plain data and rules. No React, Tauri, filesystem,
  network, parser, or editor-engine imports.
- **Application** contains use cases and ports. It coordinates domain values
  through injected interfaces and remains executable with in-memory fakes.
- **Adapters** translate a specific dependency into a port: Tauri storage,
  JSZip/DOCX encoding, Univer document/workbook editing, or a future replacement.
- **Composition roots** choose concrete adapters. They are the only modules
  allowed to know both an application use case and infrastructure.
- **Presentation** renders state and sends user intent to a use case. It never
  parses file formats or calls a vendor SDK directly.

## Working rules

1. One source of truth owns each policy. Extension lists, model catalogs,
   themes, limits, and status vocabulary are declared once and imported.
2. New dependencies enter behind a narrow port. Components do not import
   vendor packages merely because a feature needs them.
3. Prefer a small pure function over a class hierarchy. Add an abstraction only
   when it protects a real boundary or supports a second implementation.
4. Duplication is removed at the rule level, not by building generic components
   that hide unrelated behavior.
5. Composition stays explicit. No service locator, global dependency container,
   or runtime reflection.
6. Domain and application tests use fakes. Adapter tests exercise real codecs or
   host contracts. UI tests cover visible behavior and keyboard state.
7. Security checks remain independent at trust boundaries. A frontend format
   registry never replaces the Rust allowlist that protects filesystem writes.
8. A dependency swap should normally change one adapter, its focused tests, and
   the composition root—never every consumer.
9. Source module filenames use camelCase. Exported React components remain
   PascalCase; filename casing does not leak into the product vocabulary.
10. The vault's ordinary files are the data store. Do not add a database for
    state that belongs in content, clean metadata, or a rebuildable `.rotli/`
    projection.
11. The vault contract contains portable knowledge, metadata, prompts,
    protocols, and capability maps. It does not own provider clients, model calls, ranking
    execution, or agent orchestration; those remain in Rotli's AI/application
    layer behind host ports.

## Review checklist

- Is the policy defined once?
- Does dependency direction point inward?
- Can the use case run without React, Tauri, or the vendor SDK?
- Is failure represented at the layer that can recover from it?
- Are loading, empty, error, disabled, and success states owned by presentation?
- Does the security boundary validate independently?
- Did the change reduce concepts as well as lines of code?

`bun run check:architecture` requires every top-level source area and
presentation feature directory to have a named owner in
`scripts/source-ownership.ts`, discovers clean feature roles, and enforces their
inward imports, pure ports/policies, the Tauri adapter boundary, the
Markdown-only slash boundary, and the vendor seams. Discovery is never a silent
opt-in: a `src/` dir carrying role files without the full
`workflow.ts + composition.ts` split must appear in the script's named exemption
list — today `src/sheets` (a live Univer editing session; its boundaries are the
codec/engine adapters, `kinds.ts` policy constants, and the vendor seams — a
forced split would be empty wrappers), `src/boards` (the board model is
Excalidraw's vendor scene JSON behind `boards/engine`; `session.ts` +
`composition.ts` share the corpus round-trip), `src/noteChat` (no workflow
layer; its pure `model.ts` is covered by colocated tests), and `src/editor`
(`model.ts` is the live text buffer, a role-vocabulary filename collision) —
and a stale exemption fails the check. The vendor seams: `exceljs`, `@excalidraw`,
`@univerjs`, and `jszip` import only inside their codec/engine adapters
(`src/sheets/codec` + `src/sheets/engine`, `src/boards/engine` — plus
`src/app.tsx`, allowed solely for Excalidraw's theme CSS import,
`src/documents/engine` + `src/brand/univerTheme.ts`, `src/documents/codec` +
`src/documents/create.ts`). Chat and onboarding presentation are cohesive
clusters under `src/components/chat/` and `src/components/onboarding/`; new
feature-specific helpers may not accumulate at `src/components/` root. `src/lib`
is inward by default, with its store/service/Tauri-aware shell and gesture
adapters named individually in the ownership registry. `bun run check:code-shape` rejects production
module cycles and imports of test code. Architecture changes should extend these
guards instead of relying only on reviewer memory. See the
[testing contract](../development/testing.md) for the complete evidence matrix.

`src/services/` is the effectful application boundary, not a miscellaneous
bucket. Every production service declares its owning capability in
`SERVICE_FILE_OWNERS`; new files fail until they choose an owner. Physical
subdirectories may be introduced capability by capability when a cohesive move
reduces imports and survives focused tests—the registry is the migration map,
not a substitute for those eventual clusters.
