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
10. The memex is the data store. Do not add a database for state that belongs in
    content, clean metadata, or a rebuildable `.rotli/` projection.
11. The memex contains portable knowledge, metadata, prompts, protocols, and
    capability maps. It does not own provider clients, model calls, ranking
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

`bun run check:architecture` enforces the import boundaries that can be checked
mechanically. Architecture changes should extend that guard instead of relying
only on reviewer memory.
