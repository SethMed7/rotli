# rotli — audit findings (2026-06-18)

*Output of a multi-agent adversarial audit: 7 capability reviewers → refute-by-default
verification of every finding → conservative synthesis. 27 findings raised, **18 survived
verification**, **2 applied** in the audit run, the rest **deferred** (each a real, reproduced
bug, held back only because the fix is a behavior change wanting human review + a test).*

All verified findings were reproduced against the code, not reasoned about in the abstract.

> **Update 2026-06-18 (follow-up FORGE run):** the **three HIGH bugs** are now **fixed** and
> verified (two isolated reviewers each; all suites green) — see *Fixed in the follow-up run*
> below. Three lower-severity findings (4–6) remain deferred.

---

## Applied this run (low-risk, verified, covered by tests)

| id | file | what | why safe |
|---|---|---|---|
| SP-2 / TSP-4 | `src/services/notes.ts:105` | `listNotes` sort gains the `id` tiebreak to match Rust's `(pinned, updatedAt desc, id asc)` (`corpus.rs:550`) | dev/in-memory service only; deterministic; affects equal-`updatedAt` ties only; pinned by `notes.test.ts` |
| KB-1 | `src/keys/registry.ts:124` | dispatcher ignores `event.repeat` so a held chord never re-fires a command | mirrors `useHeldModifier`; no action wants auto-repeat |

---

## Fixed in the follow-up FORGE run (2026-06-18)

Each verified by two isolated reviewers and locked with a regression test.
All suites green: `tsc` · 70 `bun test` · 21 `cargo test` · hex · `vite build`.

### ✅ 1. Restore of a root-origin note now returns to the corpus root  ·  HIGH  *(FIXED)*
**`src/services/fsNotes.ts` + `src/services/notes.ts`** (`ROOT-ORIGIN-RESTORE` / `TSP-3`)
`restoreNote` now treats `origin` as three-valued: `null` → Inbox; `""` → the corpus **root**
(the distinct `Some("")` contract, `corpus.rs:162-167`); a folder id → there if it still
exists, else Inbox. The empty string is matched explicitly (the root is never in the folder
list). Locked by `notes.test.ts` *("restore of a root-origin note returns it to the corpus
root, not Inbox")*.

### ✅ 2. `titleOf` / `snippetOf` are now byte-identical to Rust  ·  HIGH  *(FIXED)*
**`src/services/derive.ts`** (`TSP-1` / `TSP-2`)
`derive.ts` is a faithful port of `corpus.rs` `strip_markdown`/`title_of`/`snippet_of` —
skip blank lines, peel `# > - * + [ ] [x] [X]` per line, drop `* _ \`` globally, code-point
140-cap — down to Rust's exact `char::is_whitespace()` alphabet (trims **U+0085**, keeps
**U+FEFF**, the two code points where JS `trim()` disagrees, so a BOM-prefixed note no longer
splits into two titles). Proven by a **300k-input differential fuzz** against a faithful Rust
reference + the Rust corpus's own vectors. `derive.test.ts` rewritten to assert parity.

### ✅ 3. `pruneQuick` no longer drops archived/trashed Quick notes  ·  HIGH  *(FIXED)*
**`src/components/QuickNote.tsx`** (`SP-1`)
The self-heal effect now confirms true non-existence via `getNote(id)` before pruning, so an
archived/trashed quick note (an id-preserving move, hidden from All-Notes) is kept — only a
genuinely purged note is dropped. Convergence (no effect loop) and the in-flight race were
verified; the premise (an archived note still resolves via `getNote`) is locked by
`notes.test.ts`.

---

## Still deferred — real bugs, fix with care (NOT applied)

### 4. Editor: paste, link href, code-span marks  ·  HIGH / med / low
**`src/editor/EditorSurface.tsx`, `render.tsx`, `commands.ts`** (`HME-1/2/3`)
- **HME-1 (high):** pasting multi-line text breaks the one-line-per-element model.
- **HME-2 (med):** rendered link `href` is unsanitized — aux-click navigation; CSP mitigates RCE but `javascript:`/`data:` should be blocked.
- **HME-3 (low):** `isMarkActive` miscounts backticks for code spans.

### 5. UI: tab reorder off-by-one, hover actions, RowMenu clamp  ·  high / med / low
**`src/lib/tabDrag.ts`, `src/components/Sidebar.tsx`, `src/components/sidebar/RowMenu.tsx`** (`CMP-1/2/4`)
- **CMP-1 (high):** `stripIndex` counts the dragged tab itself → reorder lands one slot off; needs a test.
- **CMP-2 (med):** hover-only row actions are keyboard-dead and overlap the roving-list focus.
- **CMP-4 (low):** `RowMenu` position is unclamped at the viewport edge.

### 6. QA: retired action ids in `_review` scripts  ·  med
**`_review/*.mjs`** (`QA-1`)
Some scripts `__rotli.dispatch()` action ids that no longer exist (e.g. old sidebar-toggle
ids) → silent no-ops that invalidate a few collapsed/smoke shots. Low priority: `_review/`
is gitignored throwaway. *(Companion finding QA-4 — "no JS test runner" — is **resolved** by
this run: `bun test` + the `src/**/*.test.ts` suite.)*

---

## What this run added
- A real `bun test` unit suite (70 tests, incl. the HIGH-trio regression locks) covering the corpus/lifecycle/keys/editor invariants — see `_review/README.md` for the migration story from the old screenshot scripts.
- `tsc --noEmit` + `bun test` are now both folded into `bun run check`.
- The forward build plan for Chat + smBrain multi-root: `docs/next-stages.md`.
