# Breve workflows

Status: **Stage 1 built** (2026-08-04) — read-only visualization. Stages 2–3 are
scoped here but not built.

Seth, 2026-08-04, after seeing ZenNotes' Workflows: *"in breve the different
routines are essentially workflows now so we can visually see what is happening
and edit it along with manage with AI via a side bar which opens a chat that can
help manage and create the workflow — keeping things very transparent, usable
and clean."*

## The problem

A Breve routine has **no steps on disk**. It is `(id, kind, schedule, lanes,
prompt)`; `kind` selects a hardcoded executor and the real pipeline lives in
`breve-runtime/scripts/*.sh|ts`. So the pipeline is real, elaborate, and
completely invisible — nobody can see that the morning brief sandboxes itself,
falls back across models, renders a PDF, synthesizes audio, and holds delivery
until the hour.

## Stage 1 — make it visible (built)

`src/routines/pipeline.ts` **derives** a routine's pipeline from what its
executor genuinely runs. `src/components/breve/routinePipelineView.tsx` renders
it under a "Workflow" toggle on each routine row.

### The honesty rule

The graph is **documentation-as-code, never a second source of truth**:

- It is **derived, not stored.** Nothing is persisted, so `config.version` stays
  at 1 and the built-in routines' locked shape (mandatory, disable-only, fixed
  kind+schedule) is untouched.
- It describes **what actually runs.** Every stage's `detail` names the real
  script or mechanism. `pipeline.test.ts` is the drift alarm: each test names the
  executor its expectation came from, so a script change that isn't mirrored here
  fails loudly and says where to look.
- An **unknown routine kind is not drawn as if we understood it** — it yields a
  minimal `trigger → run → deliver` sketch with `exact: false`, and the view says
  so in words.
- A stage that will **not** run on the current config (a switched-off delivery
  lane, a disabled routine) is still shown, visibly inert. Seeing what is *not*
  running is half the value.

### Why flow layout, not a graph engine

A routine pipeline is a **spine with a delivery fan at its tail** — not a general
graph. A horizontal strip of cards with a stacked final column says that exactly,
reflows in a narrow window, and needs no layout engine to keep honest. The ranked
DAG layout in `src/editor/mermaidFlowLayout.ts` (pure, tested, reusable) is the
answer when Stage 2 introduces branching, not before.

## Stage 2 — editable custom workflows (not built)

Custom routines already have a generic, env-driven executor
(`breve-runtime/scripts/custom-brief.sh`, driven entirely by
`ROTLI_ROUTINE_{ID,LABEL,PROMPT,STEM}` + `ROTLI_BREVE_LANES`), which makes them
the natural first *editable* graphs while built-ins stay read-only.

This is where the workflow becomes a **pane** (`surfaceKind: "workflow"`), so a
chat splits beside it for free — chat panes already split against anything in the
pane tree. Breve today is a `sidebarMode` that takes over the content area and is
**not** pane-capable, so this is the structural piece of the work.

Prerequisites this stage owes:

- A persisted step model ⇒ `config.version` 2, evolving **additively**;
  `ARCHITECTURE.md` requires an unsupported newer contract to fail read-only
  rather than be stamped down.
- A **dry run**. Nothing exists today: `verifyRun` in the scheduler is post-hoc
  artifact verification, not a preview. A real dry run must guarantee no-send
  through the delivery-claim layer.
- Any new executor must claim job locks and delivery receipts or
  `check:breve-contract` fails the build.
- Workflow-scoped chat: a `workflowId` scope mirroring `noteId`, new Host
  methods, and a tool-offer gate — following the `draw_board` precedent, which
  also establishes that the model should be handed a **compact text DSL, not raw
  graph JSON** (small local models write structured text far more reliably).

## Stage 3 — a general vault-workflow engine (not built, separate decision)

ZenNotes' Workflows operate deterministically on the *vault* (find notes tagged
`#book` → filter rating ≥ 4 → render a table → write into a note). Breve's
routines pull from *external* sources, run an LLM, and deliver. Those are
different animals, and rotli already has the deterministic-operations-with-
review product: **the Librarian** (proposals, grouped review, −/+ diffs,
Approve-all, undo, journal). If vault workflows are wanted, the Librarian is the
more natural home; Breve stays what it is.

## Laws this work must keep

- Breve is a rotli capability: rotli owns its UI, versioned runtime, config, and
  scheduler integration (`AGENTS.md`).
- Runtime code is versioned under `breve-runtime/`; mutable state stays in
  `.rotli/breve/`.
- **Development must not start the scheduler or write production config** —
  enforced in three places (`routines.rs`, `breve.rs` ×2).
- Secrets (Resend, `breve-gh-readonly`) stay write-only in the Keychain and must
  never surface in a workflow node's visible config.
