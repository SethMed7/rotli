# FileSurface capability audit — 2026-07-11

## Outcome

`FileSurface` still contains passive viewers that do not satisfy the workspace
invariant. They are implementation conveniences, not supported product
capabilities. This audit classifies each family by the complete workflow Rotli
should ship next; a preview plus a toolbar does not change a classification.

The complete slice delivered with this audit is native DOCX table editing plus
copy-only local conversion of `.doc`, `.rtf`, and `.odt` into managed DOCX.
Images and video remain the only accepted view-only surfaces.

## Capability matrix

| Priority | File family | Current source behavior | Honest classification | Complete target |
|---|---|---|---|---|
| shipped | Markdown notes | Hybrid source editor with disk save | edit natively | Keep Markdown-only slash, wikilink, fence, and frontmatter ownership. |
| shipped | `.docx`, `.docm`, `.dotx`, `.dotm` | Structured Univer editor and OOXML save | edit natively | Continue expanding OOXML fidelity behind the existing codec. |
| shipped | `.doc`, `.rtf`, `.odt` | Explicit local copy conversion | convert locally | Create a managed DOCX, preserve the original, then edit the result. Never add legacy extensions to slash results. |
| P0 | `.dot`, `.pages` | Explicit unsupported state | mark unsupported | Add a tested local converter only if it can produce an editable DOCX with clear fidelity disclosure. |
| shipped | `.xlsx`, `.csv` in writable lanes | Univer workbook editor with save | edit natively | Keep codec/engine boundaries replaceable. |
| P0 | `.xls`, `.xlsm`, `.ods`, `.tsv` | Passive table rendering | unsupported today | Prefer copy conversion to managed `.xlsx`; preserve formulas, sheets, types, and styles or refuse conversion. |
| P0 | plain text, logs, JSON, YAML, XML, subtitles | Read-only `<pre>` | unsupported today | Add a native text editor with encoding-aware atomic save, dirty state, errors, size limits, and narrow-window behavior. Route `.md` back to the Markdown note surface where applicable. |
| P0 | HTML/XHTML | Sandboxed preview plus read-only code | unsupported today | Add native source editing and save; keep preview sandboxed and derived from the same dirty buffer. |
| P0 | unknown files | WKWebView iframe fallback | unsupported today | Replace generic preview claims with an explicit unsupported state and external-open/reveal actions. Add format-specific workflows only as complete slices. |
| P1 | PDF | WKWebView reader | unsupported today | Either add local annotations with a user-owned PDF output/save path or provide explicit local import/conversion; reading alone is insufficient. |
| P1 | audio | Playback only | unsupported today | Produce durable transcript, cuts, annotations, or metadata with an explicit save/export path before calling audio supported. |
| allowed | raster/vector images | Fit, zoom, pan, external open | view-only exception | Keep accessible zoom/focus behavior; no editor is required by the invariant. |
| allowed | video | Playback | view-only exception | Keep playback and external-open behavior; no editor is required by the invariant. |

## DOCX workflow source QA

The following paths are established in current code and focused tests:

- **New → Document:** the shared new-item workflow creates a managed blank DOCX,
  files it in Main, refreshes projections, and opens the file surface.
- **Markdown `/Document`:** the slash catalog routes only Markdown into the
  document picker; picker filtering includes only the editable DOCX family.
- **Create and embed in place:** embedded creation uses `open: false`, inserts a
  typed `document` fence, and leaves the parent Markdown tab active.
- **Dedicated tab:** embedded controls explicitly open the same file id in a new
  file tab.
- **Save and remount:** the document shell scopes `⌘S` to the focused pane/embed,
  writes through the codec with a one-time backup, parks dirty snapshots on tab
  remount, and flushes dirty sessions on hide/quit. Theme switches no longer
  remount DOCX because document paper is intentionally independent of app theme.
- **Sheet embed lifecycle:** a Markdown `sheet` fence mounts its editor host
  before starting workbook I/O and overlays loading/error status on that stable
  host. The loader must never conditionally remove the ref it needs to mount
  Univer.
- **States:** source paths cover blank document, loading, dirty, saving, saved,
  save/load error, 12 MB refusal, read-only location, and an 800 px narrow
  layout adjustment. Error text is announced with `role="alert"` and opening
  status with `role="status"`.

Post-release native screenshots exposed visual and interaction contract
failures: theme-inverted paper, unstable first-page positioning, oversized
initial zoom, margin-corner guides, a Markdown-like block handle, low-contrast
table controls, and a table modal that discarded its insertion range. The
adapter now settles before reveal, resets to the document top, fits the complete
page in both dimensions, uses white paper with black Arial defaults, suppresses
the non-document controls, and preserves the caret through table insertion. A
dropped table command is recovered as structured document content and remounted
immediately so the canvas and eventual OOXML save agree.
The fixed-light toolbar and every document-scoped portaled popup also override
Univer's dark-mode text utilities so font labels, disabled options, hover, and
keyboard focus remain visible in all four Rotli environments.
Only content mutations activate Save; zoom operations do not. PDF frames also
request the light color scheme. Native follow-up is still required because
browser mode cannot prove WKWebView PDF rendering, filesystem writes, menus, or
titlebars.

## Fidelity boundaries

- The editable Word subset does not model floating layout, tracked changes,
  comments, fields, equations, SmartArt, embedded OLE controls, headers/footers,
  or section-level layout. Unsupported objects are retained in OOXML but cannot
  be manipulated in Rotli.
- Table cell text and formatting, rows, columns, widths, and basic merges use
  the native Univer/OOXML path. Advanced table styles, conditional formatting,
  nested tables, precise border/shading ownership, and floating tables remain
  preservation-first rather than editable.
- macOS `textutil` conversion is local but not lossless. Complex layout,
  embedded objects, macros, legacy fields, and application-specific features
  require review in the converted DOCX. The original remains the recovery truth.
