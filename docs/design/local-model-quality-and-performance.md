# Local model quality and performance

Status: plan. No code has been written for it. Every claim below is either cited to
`file:line` in this repo (or to the model server / installed `mlx_lm` on this machine), or
marked explicitly as unmeasured.

## The brief

the maintainer's priorities, in his order:

1. **Output quality** — most important.
2. **Speed.**
3. **How it uses the computer** — "my computer keeps getting really loud and hot."

Those three look like they fight. Axis 1 says *reason more*; axis 3 says *compute less*. A
plan that adds reasoning turns and then bolts on a thermal gate to undo them is incoherent —
it buys quality with heat and then refunds the quality when the machine warms up, which
inverts the stated ordering.

**This doc resolves the tension by rejecting its premise.** Extra loop steps are not
expensive because the model thinks. They are expensive because *every step re-ingests the
entire prompt from scratch.* Prefill dominates a step by roughly an order of magnitude
(measured below). Break that coupling and an added step costs its own appended text plus
decode, not a full re-prefill — so the same change lowers heat several-fold whether or not a
single reasoning step is ever added, and makes an added step affordable if one is later
justified.

The stack is therefore ordered as a **budget**: build the meters, then cut waste, and only
then spend any of the recovered headroom on quality. The standing accept rule for every PR:

> **Quality must not fall AND generations-per-turn must not rise** — on the same case file,
> the same model, the same vault snapshot.

---

## The harness question, answered honestly

the maintainer originally asked about integrating third-party agent harnesses (opencode, pi) because
"these harnesses tend to improve quality of models sometimes." He has since parked that as
research-only and pointed at ReAct-style reasoning loops as the direction. The fair question
is: **can rotli's own loop get harness-grade gains?**

Partly. Harness-grade quality has three distinct sources, and they do not have the same
answer.

**1. Cheap iteration — YES, and this is the big one.** Harnesses feel smart partly because
their loops are cheap enough to run often. rotli's is not. Every step re-prefills a
multi-thousand-token prompt, and prefill is the overwhelming majority of a tool step's cost.
This is entirely available to us — and notably it is *invisible to any third-party harness*,
because the problem lives in the model server, below where a harness sits. No harness would
have found it.

**2. Structural reliability — YES, cheaply.** Harnesses constrain output shape so malformed
steps cannot happen. rotli's `formatJson` is an English sentence appended to the prompt plus
a post-hoc brace slice, and the streaming path skips even the slice. The loop never sends a
temperature at all — `CompleteReq` is `messages` + `formatJson` only
(`src/ai/types.ts:58-62`), so a strict JSON protocol decision and a paragraph of prose both
land on the same default (`src-tauri/src/chat.rs:288-289`). Each malformed reply costs a
whole generation plus a strike (`src/ai/loop.ts:162-174`). That is recoverable without any
harness.

**3. Deeper reasoning — NO, and we should stop assuming otherwise.** The repo's own record is
that prompt-only work bought net +1 correct / +1 partial of 9 and concluded "the rest needs
code" (`docs/design/local-model-retrieval-notes.md:383-395`), while the change that actually
moved roster questions 0/2 → 2/2 was retrieval metadata, not reasoning (`:420-424`). A 12B
does not become a 200B by looping harder on a serialized single GPU slot.

**Net: we can buy harness-grade *cheapness* and harness-grade *reliability* inside our own
loop. We cannot buy harness-grade *depth*.** This plan makes exactly one reasoning bet
(PR 9), it costs zero extra generations, and it ships with a kill criterion declared in
advance.

---

## Axis 1 — Quality

### Current measured reality

rotli's loop is ReAct-lite with the "Re" half discarded. Per step it re-renders the entire
prompt, runs exactly one generation, parses one JSON object, dispatches at most one tool, and
appends `{action, result}` to the scratchpad (`src/ai/loop.ts:108-227`). A `final` returns
immediately and unchecked. There is no self-verification, reflection, or answer retry
anywhere in `src/ai/` — `src/ai/verify.ts` is a connected-lane liveness ping and `loop.ts`
never imports it.

Three concrete losses, all verified:

| What | Where | Cost today |
|---|---|---|
| Both adapters require a `"thought"` every step; `parseAction` reads only `final`/`tool`/`args`; `ScratchStep` is `{action, result}` | `src/ai/prompt.ts:139`, `src/ai/parse.ts:51-60`, `src/ai/types.ts:119-122` | rotli generates a ReAct trace every step and deletes it |
| The loop never chooses sampling parameters | `src/ai/types.ts:58-62`, `src/ai/loop.ts:132-137` | temp 0.4 / 1024 tokens for a JSON decision *and* for prose |
| The model is told its **total** step budget, never its remaining budget | `src/ai/prompt.ts:175` (`Use at most ${ctx.maxSteps} steps`) | the documented F3 "single-read satisficing" failure |

The recorded baseline (`docs/design/local-model-retrieval-notes.md:77-84`), 20 real questions:
9 correct / 1 partial / 10 wrong for the 12B; read a note before answering in 14/20 runs; avg
4.0 model calls; ~62 s wall per question; 6/20 cases hit a truncated read.

Two budget constants are directly implicated in that baseline and **no PR in the original
drafts touched them**: `maxIndexChars: 3500` and `readNoteChars: 6000` on a 128k-window model
(`src/ai/budget.ts:80-89`). The fixture harness's own comment records the measured 2026-08-01
production failure: the knowledge map the model actually saw listed 9 areas, none of them
people (`scripts/eval-local-chat.ts:130-135`). The retrieval notes state outright that "map
budget measurably changes outcomes for identical questions"
(`docs/design/local-model-retrieval-notes.md:133`) and that roughly a quarter of all notes
truncate on read at the current 6000 (`:32-34`, `:187-193`).

Also verified: there is no full worked ReAct trajectory anywhere in `src/ai/prompt.ts`. The
gemma prompt does carry inline BAD/GOOD answer exemplars and a two-part-question strategy
(`src/ai/prompt.ts:154-160`), but never a complete search → read → answer trace.

### Levers, and what proves each one worked

| Lever | Extra generations | Proof |
|---|---|---|
| Cold sampling on the step generation | **0** (removes wasted ones) | malformed-reply count, duplicate-call strikes, truncation count all fall; verdicts flat-or-up |
| Reuse the run's knowledge map on an empty search (`src/ai/tools.ts:255-262` rebuilds an 8000-char map that `loop.ts:80` already fetched) | **0** | `knowledgeMap` call count per run drops 2 → 1 on any empty-search case |
| Worked ReAct exemplars in the cached prefix | **0** | `readBeforeFinal` up on enumeration cases; verdicts up beyond the published noise floor |
| Bigger map / read budgets, paid once per turn post-cache | **0** | `truncations` down; verdicts up; prefill cost bounded by the cache |
| Carry the model's own `thought` forward | **0** | verdicts up beyond noise floor at flat-or-lower generations-per-turn |

Nothing in this plan adds an unconditional generation. That is not squeamishness — on a
serialized slot an added generation queues in front of the user's next message.

---

## Axis 2 — Speed

### Current measured reality: prefill is the cost

Measured against a reference development server (warm `gemma-3-12b-it-qat-4bit`, Apple Silicon,
`temperature 0`, `num_predict 8`):

| Prompt | Generation | Wall |
|---|---|---|
| 455 chars (~113 tok) | 8 tokens | 0.61 s, then 0.44 s on repeat |
| 15,990 chars (~4,000 tok) | 8 tokens | 8.19 s, then 9.95 s |

Prefill runs at roughly 440 tok/s (~2.3 ms per prompt token) and dominates a step by ~15×.
**Note the spread: the same 4k probe measured 8.19 s and 9.95 s, ~20%.** Any wall-clock claim
in this plan must clear that band or be averaged over repeats — which is one of several
reasons wall time is not the acceptance metric for the cache.

Arithmetic of the tension: on the 128k tier the stable prefix (instructions + knowledge map
≤3,500 chars + history ≤12,000 chars) is ~20k chars ≈ 5k tokens ≈ ~11 s of prefill, re-paid on
every one of up to 5 steps plus the unconditional force-final (`src/ai/budget.ts:80-89`,
`src/ai/loop.ts:108`, `:231`).

There is no prompt cache. `~/.memex/ai/mlx-server.py` calls `generate` / `stream_generate`
with no `prompt_cache` argument, even though the installed `mlx_lm` 0.29.1 supports it
(`mlx_lm/generate.py:306`).

### Why the naive fix regresses (this is the load-bearing finding)

Wiring a stock prompt cache straight in was **measured as an 8% net regression, with zero
reuse.** The mechanism, derived from source:

1. **The rendered prompt is not append-only.** Both adapters put a trailing instruction
   *after* the scratchpad — `Respond with the next single JSON object now.`
   (`src/ai/prompt.ts:186`) and `The next single JSON object:` (`src/ai/prompt.ts:259`).
2. **Prior text mutates mid-turn.** `pruneScratch` truncates the *earliest* entries first and
   rewrites them in place: `cur.result = \`${cur.result.slice(0, keep)}…(trimmed)\``
   (`src/ai/tools.ts:174-189`; note `:176` sums only `e.result.length`).
3. **An empty scratchpad renders a placeholder.** `if (scratch.length === 0) return "(nothing yet)";`
   (`src/ai/prompt.ts:89`) — so step 1's tail is `(nothing yet)` and step 2's is
   `STEP 1 ACTION: …`. The first is not a prefix of the second, and this breaks the transition
   where the stable prefix is the *largest* share of the prompt.
4. **The server appends a suffix rotli never sees.** `_prepare` in `mlx-server.py` does
   `prompt = prompt + "\n\nReturn ONLY a single valid JSON object" + guide + ". No prose, no markdown, no code fences."`
   whenever `format` is set — and it always is for the default local model (`gemmaAdapter` has
   `wantsFormatJson: true`, `src/ai/prompt.ts:109-110`; `src-tauri/src/chat.rs:484` buffered and
   `:534` streaming both set `body["format"]`).
5. **The chat template appends more.** Both server paths call
   `tok.apply_chat_template([...], add_generation_prompt=True)`, adding gemma's
   `<end_of_turn>\n<start_of_turn>model\n` after everything.
6. **The stock cache stores prompt ‖ completion.** `mlx_lm/server.py` builds
   `cache_key = prompt[:]`, appends every generated token during decode, then inserts. rotli
   never re-feeds the raw completion — `loop.ts:179` re-serializes it as
   `` `${tool} ${JSON.stringify(args)}` `` — so the stored path diverges immediately.

Any one of those breaks the token prefix. And when the prefix breaks, the failure is total,
not partial: in `fetch_nearest_cache` the trie walk leaves `last_cache_index = -1`, the
free-reuse `shorter` branch is gated on `last_cache_index > 0` and is skipped, control falls
to the `longer` branch, which requires `can_trim_prompt_cache` — and that is **permanently
False for this model**. `gemma-3-12b-it-qat-4bit`'s config is 48 layers, `sliding_window 1024`,
`sliding_window_pattern 6`, so `make_cache` (`mlx_lm/models/gemma3_text.py:247-257`) gives
**40 of 48 layers** a `RotatingKVCache(max_size=1024)`, whose `is_trimmable()` is
`self.offset < self.max_size` (`mlx_lm/models/cache.py:511-512`). Every real rotli prompt is
2k–5k tokens. Trim is dead. The call returns `(None, tokens)` — a full re-prefill plus
trie-walk overhead. That is the 8%.

**Measured, not assumed.** Feeding realistic step prompts through the real gemma tokenizer:
the raw `renderScratch` appends *do* hold a strict token prefix (101/101, 173/173) — but once
`apply_chat_template` runs, P1→P2 gives `len(prev)=110`, `len(next)=182`, `common=105`,
`strict_token_prefix = False`. Zero reuse, every step, while a string-level property test on
`renderPrompt` output stays perfectly green.

**Consequences the plan encodes:**

- The append-only work (PR 5) is **necessary but not sufficient**. `pruneScratch`'s retroactive
  rewrite breaks the prefix in the *middle*, which no keying scheme survives.
- The cache cannot be the stock `LRUPromptCache`. It must **snapshot before decode** and key on
  prompt-only tokens, so the completion tokens and the template tail never enter the stored
  state. Inserting a post-decode cache object under a prompt-only key would silently mismatch
  KV against key and corrupt continuations rather than merely miss — that trap is named here so
  nobody discovers it in an implementation.
- The proof must be a **reuse counter**, not wall time. See the measurement contract.

### The prefix-destroying trap this plan explicitly refuses

An earlier draft proposed telling the model its **remaining** steps by substituting
`${ctx.maxSteps}` at `src/ai/prompt.ts:175`. That is per-step-varying text *inside the stable
prefix*. It looks free and would have silently disabled the largest win in the stack. It
survives only in an append-only form: the counter is written once into each appended step block
and never rewritten (PR 9).

**General rule for this stack: a quality lever is admissible only in a shape that does not
re-pay the prefill.**

### Memory is the cache's real price, and it is not small

From the model config (`num_key_value_heads 8`, `head_dim 256`, 48 layers, bf16):
2 × 8 × 256 × 2 bytes = **8 KB per token per layer**.

Running the actual `KVCache` / `RotatingKVCache` classes from the installed venv with
`prefill_step_size=2048` over a 5,000-token prompt:

- 8 full-attention layers settle at `(1, 8, 5000, 256)` = 40.96 MB each
- 40 rotating layers settle at `(1, 8, 1927, 256)` = 15.79 MB each (not 1024 — `_update_concat`
  leaves them at `max_size + S − 1`)
- **Total = 959,119,360 B ≈ 0.89 GB per cached turn**

`RotatingKVCache.to_quantized` raises `NotImplementedError`, so this cannot be shrunk by
quantizing the cache. And 0.89 GB **exceeds** the 768 MB `localRequestOverheadMB` knob that
`src-tauri/src/compute.rs:47` and `docs/design/local-compute-guardrails.md:160` both document as
covering "KV cache + activations."

Two honest qualifiers:

- `mlx_lm/generate.py:362` already allocates the same buffer for *every* generation today and
  frees it at generation end. PR 6 changes the cache's **lifetime**, not the peak for a single
  in-flight turn. With the server's process-wide lock serializing generation and strict
  per-turn scoping, incremental peak RSS should be near zero.
- `compute.rs` is not blind to it — `read_memory()` reads `kern.memorystatus_level`
  (`compute.rs:166`), a live system-wide figure, so any retained allocation reduces the next
  admission decision's input. What it cannot do is *attribute* or *pre-price* the cache.

The residency risk is real and unpriced, so PR 6 carries a memory bar and a reaper.

---

## Axis 3 — Thermal

### Current measured reality: rotli has no working thermal signal

`probe_thermal_ok()` (`src-tauri/src/organizer.rs:1986-1999`) shells `pmset -g therm` and parses
a line prefixed `CPU_Speed_Limit`, treating ≥ 80 as OK.

**Run on this M4 Max, exit 0, full output:**

```
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
```

There is no `CPU_Speed_Limit` field. `CPU_Speed_Limit` is an Intel-era metric. The
`strip_prefix` at `organizer.rs:1992` never matches, and control reaches the fall-through `true`
at `:1998`. Corroborating: `sysctl -a | grep -i thermal` returns nothing on this machine.

Its **only** consumer is `GateProbes::refresh` (`organizer.rs:1964`), feeding `gates_pass`
(`organizer.rs:988`: `g.on_ac && g.thermal_ok && (g.user_idle || g.app_backgrounded)`). A full
grep of `src-tauri/src` finds no other caller — nothing in `chat.rs` or `compute.rs` asks about
heat at all.

**So: the organizer daemon's thermal gate has been permanently open for its entire life, and the
interactive chat path has never had one.** That is the finding, and it belongs stated as a defect
rather than buried as a justification.

A live replacement exists, needs no privileges, no `sudo powermetrics`, and **no new crate** —
`objc2-foundation = "0.3"` is already a macOS dependency (`src-tauri/Cargo.toml:52`) and
`NSProcessInfo` is one of its cargo features.

`ProcessInfo.processInfo.thermalState` was read twice on this machine during this work:
`nominal` (raw 0) at rest, and `fair` under agent load. **Two distinct values means the signal
moves.** That is the whole case for adopting it — and it is also the case for *not* gating on it
yet, because we have never observed `serious` or `critical` here at all.

### What thermal work this plan does and does not do

It **records**. It does **not gate chat**, and it does **not change daemon admission**.

Degrading answers because the machine is warm inverts the maintainer's own priority order. And post-cache,
most of the heat such a gate would save is already gone. The measured entry condition for
reconsidering is in Open Questions.

One correction to an earlier draft, because it would have shipped a regression: replacing the
*body* of `probe_thermal_ok` cannot "keep daemon admission identical" — that function's only
consumer *is* the gate. Worse, the existing gate tests construct `GateSnapshot` with literal
`thermal_ok: true` / `false` (`organizer.rs:2918`, `:2926`) and never invoke the probe, so
"daemon gate tests pass unchanged" is satisfied by construction and could not detect the change.
PR 2 therefore adds a **new** telemetry probe and leaves `probe_thermal_ok` and `GateProbes`
untouched.

---

## The measurement contract

Nothing in this plan ships on an argument. This section is the standard every PR is held to, and
it exists because the current harnesses cannot support the gates an earlier draft wrote for them.

### Two harnesses, and which one is the gate

| | `scripts/eval-local-chat.ts` | `scripts/eval-vault-sweep.ts` |
|---|---|---|
| Corpus | 42-note synthetic fixture, in repo | the real vault, cases outside the repo |
| Retrieval | hand-written TS twin of `corpus.rs` (`:279-298`) | the packaged read-only CLI — `notes search` **is** `corpus_search` |
| Scoring | 8 boolean cases, non-zero exit | 4-valued verdict + `minGroups` + leak regexes |
| Output | console + per-case `.txt`, **no summary.json** | `summary.json` (`:372`) with steps/toolPath/readBeforeFinal/truncations/wallMs/modelMs |
| Reproducible | yes | no (vault drifts) |

**The fixture harness is the gate** — it is reproducible and repo-safe. The sweep is the reality
check, run at milestones with a pinned vault snapshot. Both are excluded from `bun test` by
design (no `.test.ts` suffix) and cannot be CI gates: CI has no MLX server and no vault.

### Two lanes, because "byte-identical" is currently unachievable

Both harnesses hardcode `options: { temperature: 0.4, num_predict: 1024 }`
(`scripts/eval-local-chat.ts:317`, `scripts/eval-vault-sweep.ts:128`), neither flag parser
accepts `--temp`/`--seed`/`--repeat`, and `mlx-server.py` never touches `mx.random.seed`. Every
non-trivial field of `CaseResult` (`eval-vault-sweep.ts:224-237`) — `verdict`, `steps`,
`toolPath`, `readBeforeFinal`, `truncations`, `final` — is a sampled model output. So a demand
for byte-identical live results fails on an unchanged tree and would, in practice, be quietly
reinterpreted as "close enough" at exactly the moment it is supposed to bite.

The fix is one line away: `mlx_lm/sample_utils.py:45-46` is
`if temp == 0: return lambda x: mx.argmax(x, axis=-1)`, and temperature already rides the
existing options object.

- **Deterministic lane — `temperature: 0`.** For PRs that assert *no behaviour change*:
  vendoring, telemetry, prompt reordering. There, "identical verdicts" is a real bar.
- **Stochastic lane — `temperature: 0.4`, `--repeat N`.** For quality PRs. Each case becomes a
  pass-rate k/N.

Caveat recorded up front: **even the deterministic lane cannot promise identical text once the
cache lands**, because a cached KV prefix changes prefill chunking and therefore float reduction
order. PR 6's quality bar is a noise-band comparison; the reuse counter carries the real load.

The word "byte-identical" is reserved for the one thing that genuinely is deterministic: the
**scorer over a recorded transcript** (`scripts/eval-report.test.ts` — fixed transcript in, fixed
verdict out).

### The published noise floor

Before any before/after claim: run the unchanged harness at `--repeat 5` on the stochastic lane
and **publish the unstable set** (cases where 0 < k < 5). That set *is* the noise floor. Any
claimed improvement smaller than it is rejected as unproven — including, potentially, some
historical PASS/FAIL claims in existing notes, which were single-sample.

### The lane gap nobody was measuring

Both eval hosts implement only `complete` and POST `stream: false`
(`eval-local-chat.ts:310-332`, `eval-vault-sweep.ts:122-143`). `Host.stream` is optional
(`src/ai/types.ts:72`) with a `complete` fallback (`src/ai/loop.ts:49-50`), and
`src/ai/host.ts:444-453` installs `stream` for local generate models — with
`useStream = input.stream !== false` (`loop.ts:70`), streaming is the **default for every step of
a local turn**, not just the final one. The server's two paths are separate function bodies
(`_run`, `_run_stream`).

This is a fidelity gap, not a catastrophe. The buffered path is also shipped (hybrid preset inner
legs at `src/ai/hybrid.ts:118-120`, all connected lanes, `complete_local` for the daemon, vision),
and `mlx-server.py`'s `_prepare` is shared by both, so `promptChars` and prefill work — the
quantities PRs 5 and 6 are about — are lane-invariant.

But two things are **not** lane-invariant and are called out where they matter:

1. `src/ai/loop.ts:150-153` bypasses `parseAction` when the extractor classified `final`, so a
   truncated JSON final is absorbed as the answer while streaming but is `unparseable` → strike →
   extra generation while buffered. Failure accounting differs between lanes.
2. `_run_stream` closes its generator on client hang-up (rotli Stop,
   `src-tauri/src/chat.rs:545-547`). A cache holding prompt + partial generation would then be
   shorter-prompt-next-time → `longer` branch → dead trim → silent full re-prefill. **A
   stream-only failure mode the buffered harness cannot see.**

So: **PR 6's cache proof must be re-run against `_run_stream`, including an abort-mid-stream
case.** Full TTFT plumbing in the harness is *not* required — prefill dominates ~15× so turn ms
proxies it, and harness TTFT would be optimistic anyway since it bypasses Tauri IPC and
`compute::with_slot`.

### What the server can and cannot tell us today

An earlier draft promised to read "the server's own `eval_count`/`prompt_eval_count` counters"
and blamed `src-tauri/src/chat.rs:493-498` for not parsing them. **That is wrong on two counts.**
rotli does not talk to Ollama; it talks to a hand-written `memex-mlx-0.3`, whose entire buffered
reply is `{"model", "response", "done"}` (`mlx-server.py:387`) with the stream twin emitting the
same three fields (`:414-415`). `grep -n 'eval_count|total_duration|prompt_eval'` on that file
returns nothing. And both harnesses bypass Rust entirely — each hardcodes
`http://localhost:11435` (`eval-local-chat.ts:23`, `eval-vault-sweep.ts:32`) — so a `chat.rs`
change would not reach them regardless.

The counters *do* exist inside `mlx_lm` (`GenerationResponse.prompt_tokens` /
`generation_tokens` / `finish_reason`, `mlx_lm/generate.py:270-286`); the server discards them
(`_run` returns only the string; `_run_stream` keeps only `resp.text`).

**Therefore: PR 1 ships no token counters.** It ships `promptChars`, generated chars,
generations-per-turn, and wall/model ms — all computable from what the harnesses already hold.
Token counters get an explicit home in PR 4, the first PR that may change the server's reply
shape.

---

## The stacked PRs

Workflow is rotli's usual: branch → PR → Greptile → squash merge → release.

| # | Axis | What | Adds generations? |
|---|---|---|---|
| 1 | measure | Shared scorer, `summary.json` for both harnesses, cost telemetry, `--repeat`/`--temp`, doc + index repair | 0 |
| 2 | thermal | A thermal probe that exists — **telemetry only, no gate** | 0 |
| 3 | measure | Vendor `mlx-server.py` with a version handshake | 0 |
| 4 | measure | Server telemetry: token counts, `finish_reason`, reuse counters | 0 |
| 5 | speed | Make the **wire payload** append-only | 0 |
| 6 | speed/thermal | The prefix prompt cache — the joules PR | 0 |
| 7 | quality | Cold decisions; stop building the knowledge map twice | 0 (removes wasted ones) |
| 8 | quality | Spend the recovered prefill on grounding | 0 |
| 9 | quality | Carry the model's own reasoning forward — one bet, with a kill criterion | 0 |

---

### PR 1 — The instrument

**What.** `scripts/eval-local-chat.ts` times every generation and throws it away: `ms` is
captured at `:330` and printed into a human-readable transcript with no machine-readable output,
while `eval-vault-sweep.ts` already writes `summary.json` (`:372`). Extract the sweep's 4-valued
scorer into a shared `scripts/eval-report.ts`, give the fixture harness the same `summary.json`,
and add to both:

- `promptChars` per step — the heat driver
- **generations-per-turn** — the headline cost metric
- generated chars, wall ms, model ms
- `--repeat N` and `--temp` flags (the deterministic lane needs `--temp 0`)
- the **counterfactual defect-trigger rate**, at zero generation cost: how often a run *would
  have* fired a re-check gate — no `read_note`/`read_memory` in `toolPath`, a `[…truncated`
  marker (`src/ai/tools.ts:75-78`), or a final sourced from a frontmatter `links:` line
  (`src/ai/tools.ts:57-69`). That single counter decides the reflection question later without
  spending a generation now.

Also: fix `eval-local-chat.ts`'s stale usage header (`:3` lists 5 of 8 cases). Ship this doc and
repair a real convention failure — `docs/README.md` routes to 2 of the 10 files in
`docs/design/`, and `local-compute-guardrails.md`, the direct predecessor of this work, is one of
the orphans. `scripts/check-documentation.mjs:165` only scans `.mjs`/`.sh`, so unindexed design
docs pass CI today; the gap is a convention failure, not a build failure. The untracked draft of
this file in the working tree is replaced by this PR's version, not merged around.

**Proof.**

- (a) `scripts/eval-report.test.ts`: fixed recorded transcript in → fixed verdict out,
  byte-identical. This — not a live run — is where "byte-identical" applies.
- (b) `--repeat 5` on the stochastic lane; **publish the unstable set**. That is the noise floor
  everything downstream is measured against.
- (c) A deterministic-lane (`--temp 0`) baseline recorded for PRs 3, 4 and 5 to compare against.
- (d) The self-proving invariant: **`git diff --stat src/ai` must be EMPTY.** A verdict change is
  impossible by construction.
- `bun run check:docs` green with the new `package.json` scripts documented in
  `docs/development/testing.md`'s command map (which today documents neither live script).

**Risk.** The scoring is keyword-substring matching (`eval-local-chat.ts:414-420`,
`eval-vault-sweep.ts:209-218`), so "quality" here means "keyword recall" — gameable by verbatim
note dumping in one direction and by synonyms in the other. Do not let the proxy be promoted into
the goal; every later claim carries a hand-read sample. Second: running evals more often is
itself an axis-3 cost (8 cases × up to 6 generations on a 12B, × N), so default N stays 1 and
`--repeat` is opt-in for baseline and acceptance runs.

---

### PR 2 — A thermal signal that exists (telemetry only)

**What.** Add a **new** `probe_thermal_state() -> ThermalState` reading
`ProcessInfo.processInfo.thermalState` via the already-present `objc2-foundation`
(`src-tauri/Cargo.toml:52`, enabling its `NSProcessInfo` feature). Sample it into the queue
snapshot and into each eval case's record.

**Leave `probe_thermal_ok` and `GateProbes` untouched.** Daemon admission does not move, by
construction rather than by assertion. The `not(macos)` twin at `organizer.rs:2002` stays
permissive per `docs/design/cross-platform-feasibility.md:111`.

Record in this doc — as this section already does — that the daemon has had **no working thermal
gate for its entire life**.

**Proof.** A pure unit test over the state → label mapping. A one-shot dev command printing the
live state. And the bar that matters: sample `thermalState` through a full suite run and show the
value **moves off its resting state**. `nominal` at rest and `fair` under load are already on
record; if a loaded suite fails to reproduce a transition, we report the probe as still-weak
rather than quietly shipping a claim.

**Risk.** `thermalState` is the OS's coarse 4-value verdict, not a temperature or fan reading, and
it may be a *late* signal that moves only once the machine is already backing off. That is fine
for recording and not fine for gating, which is why this PR ships no gate and states no mapping
to admission. When a gate is eventually considered, the mapping must be written down explicitly
and **`fair` must permit work** — `fair` has been observed on an essentially idle M4 Max, so a
nominal-only rule would trade a probe that is always true for one that is effectively always
false.

---

### PR 3 — Vendor `mlx-server.py` with a version handshake

**What.** The most load-bearing runtime in this plan is not in this repository.
`~/.memex/ai/mlx-server.py` (19,955 bytes) is hand-maintained, shared with Breve and warble,
versioned by a `VERSION = "memex-mlx-0.3"` string plus hand-made backups sitting beside it
(`mlx-server.py.bak-0.2`, `.bak-pre-streaming`, both confirmed on disk). rotli manages only the
launchd plist and the models directory, and `src-tauri/src/chat.rs` has no server-version
negotiation — it only ever POSTs `/api/generate`.

Every remaining high-leverage lever lands in that file. Vendor a repo-owned copy the way
`breve-runtime/` already is, teach `localmodel.rs` to install it **beside** the user's file and
switch by plist (additive and reversible, never overwrite in place), and add a rotli-side version
probe. The server already serves `GET /api/version` → `{"version": VERSION}`
(`mlx-server.py:356-358`), so the vendored copy can be a literal byte-for-byte copy and this PR
is purely rotli-side work.

**Proof.**

- **Primary, deterministic:** `diff server/mlx-server.py ~/.memex/ai/mlx-server.py` is empty at
  vendoring time, plus a checked-in hash **of the vendored copy** and an install-time comparison
  so drift is detectable later. (A hash of the user's mutable out-of-repo file would be wrong —
  Breve and warble may legitimately change it.)
- The version probe returns the string rotli asserts against, and a deliberate downgrade to
  `.bak-0.2` produces a clear non-crashing degradation rather than a silent wrong answer.
- **Smoke only, on the deterministic lane:** verdicts unchanged. This is a smoke check, not the
  gate — the gate is the diff. Running a ~20-question sweep at ~62 s per question to detect a
  file-copy error is the least sensitive and most expensive test available, and at temperature
  0.4 it could not be byte-identical anyway. What the smoke check genuinely adds over a diff is
  that the plist switch actually serves the vendored file end to end.

**Risk.** This makes rotli the de-facto owner of a runtime two other products depend on (Breve via
`breve-runtime/scripts/llm.ts`, warble likewise), and a rotli-driven upgrade could break them.
**That ownership decision is the maintainer's call and is recorded here, not assumed by the installer.** The
installer being additive and plist-switched is the mitigation that keeps it reversible.

---

### PR 4 — Server telemetry: tokens, `finish_reason`, reuse counters

**What.** The first PR that changes the server's reply shape, and it changes only that. Surface,
additively, on both `_run` and `_run_stream`:

- `prompt_tokens`, `generation_tokens` (already inside `GenerationResponse`,
  `mlx_lm/generate.py:270-286`, discarded today)
- `finish_reason` — needed to count truncations at the 1024-token cap, which is PR 7's falsifier
  in the direction that matters
- `cached_prompt_tokens` — emitted as 0 until PR 6 exists

This is a **compatibility-relevant external protocol change** to a runtime Breve and warble also
consume. Additive fields only; older clients ignore them; rotli tolerates their absence (an older
server via the plist switch must degrade, not crash).

Parse them rotli-side (`src-tauri/src/chat.rs`) and capture them in both harnesses' `StepLog`.

**Proof.** Fields present on both paths; values sane against an independent tokenizer count;
verdicts unchanged on the deterministic lane; the `.bak-0.2` downgrade still works with the
fields absent.

**Risk.** Touching the shared runtime again — mitigated by PR 3's vendoring and version probe
landing first. Keep the change additive: nothing may be removed or renamed in the reply.

---

### PR 5 — Make the wire payload append-only

**What.** Four changes that together give a turn a strict **token**-prefix property on the
sequence the server actually tokenizes:

- **(a)** Move the trailing instruction *above* the scratchpad in both adapters —
  `Respond with the next single JSON object now.` (`src/ai/prompt.ts:186`) and
  `The next single JSON object:` (`:259`) — so `renderScratch` is genuinely last.
- **(b)** Render an **empty string** for an empty scratchpad instead of `(nothing yet)`
  (`src/ai/prompt.ts:89`), moving the human-readable hint into the stable text above. Step 1's
  prompt then ends at `YOUR WORK SO FAR:\n`, which step 2 extends cleanly.
- **(c)** Make `pruneScratch` append-safe. It currently truncates the earliest entries first and
  rewrites them in place (`src/ai/tools.ts:174-189`) — mutating text the model already read,
  mid-turn, exactly when the prompt is largest. Cap each result at **append time** and never
  rewrite it, so total scratch is bounded by `maxSteps × per-result cap`.
- **(d)** Move the server's JSON-format guide to the **head** of the prompt (`_prepare`,
  `mlx-server.py:311-315`), or fold it into rotli's adapter text so the server appends nothing.
  It fires on every local gemma step, buffered and streaming, and a constant suffix is fatal:
  `P_N ‖ S` is a prefix of `P_{N+1} ‖ S` only if `S` is a prefix of `Δ ‖ S`, which it is not. If
  the guide moves into rotli's own text instead, the buffered path's `_extract_json` brace slice
  goes with it — `src/ai/parse.ts:8-32` already does a stricter, string-aware balanced-brace
  extraction, so that is a deletion, not a port, but it must be stated rather than assumed.

The chat template's trailing `<end_of_turn>\n<start_of_turn>model\n` is **not** fixed here — it is
unavoidable for a single-user-message wire shape. It is handled in PR 6 by snapshotting the cache
*before* the template tail and decode.

**Honest note:** this PR has no user-visible effect on its own. Its entire value is realised by
PR 6, and PR 6 is a measured net regression without it.

**Proof.**

- A property test asserting the invariant **in tokens, not characters**: tokenise with the target
  model's tokenizer and assert `tokens(P_n) == tokens(P_{n+1})[:len(tokens(P_n))]` for every n
  **including n = 0**, for both adapters, past the pruning threshold, and **on the payload after
  `_prepare`'s format guide** — i.e. what the server tokenizes, minus the documented template
  tail. A string-level test in TS cannot see what the server appends, and a string-prefix test is
  green in precisely the world where reuse is zero. Keep the string version as a cheap fast-fail;
  it is not the proof.
- Deterministic-lane verdict distribution unchanged. This is a reordering; if it changes answers
  we need to know now, before PR 6 hides it behind a speed win.

**Risk.** Trailing instructions may be load-bearing for a small model — recency matters in
prompting, and this applies to (d) as much as (a). `prompt.test.ts` pins prompt strings by exact
substring, so pins will move; a moved pin is a rename, not evidence, which is exactly why the real
proof is the token invariant plus the eval delta. If the deterministic lane regresses, duplicate
the instruction into the head rather than abandon the invariant. **The invariant is the asset.**
Note also that (d) edits the vendored server, which is why PR 3 lands first.

---

### PR 6 — The prefix prompt cache (the joules PR)

**What.** A request-scoped prefix cache in the vendored server. Explicitly **not** a wiring job on
the stock `LRUPromptCache` — that is a globally shared, content-addressed token trie keyed per
model with `max_size = 10`, storing prompt ‖ completion. Required shape:

- **Snapshot before decode.** Run prefill as a separate pass, snapshot the cache state, then
  decode from a copy. The stored state must contain **prompt-only tokens** — no completion, no
  template tail. Inserting a post-decode cache object under a prompt-only key silently mismatches
  KV against key and corrupts continuations rather than merely missing.
- **Key = (model path, scope key, prefix boundary).** The model path is not optional: one
  `requestId` spans *multiple models* inside a hybrid preset — it is minted once at
  `src/components/chat/chatSurface.tsx:1223` and reused by `runHybrid` for the routing generation, the
  executor leg, and a fallback leg on a different model (`src/ai/hybrid.ts:88`, `:112`,
  `:136-139`). This is not hypothetical: the shipped `starter-private` preset
  (`src/ai/models.ts:291-300`) pairs a `qwen2.5-3b` organizer with a `gemma-3-12b` route/fallback,
  both local, both on `:11435`, in one turn. Handing a 36-layer qwen cache to 48-layer gemma does
  not raise — `for i, (layer, c) in enumerate(zip(self.layers, cache))`
  (`mlx_lm/models/gemma3_text.py:205`) silently truncates the layer stack. Assert model equality
  on fetch.
- **The scope key must ride the wire, and absence must fail closed.** Today `requestId` is
  optional at every hop (`src/ai/host.ts:154`, `src/lib/tauri.ts:417`), `chat.rs:309` mints one
  when absent, and that id is used **only** as the compute-queue key — it is never placed in the
  `/api/generate` body (`chat.rs:467-489`). So this is *new plumbing over a live keyless path*.
  Keyless callers exist inside rotli too: `src/components/settingsSurface.tsx:2003` calls
  `makeTauriHost(def)` with no opts, and `complete_local` (`chat.rs:443-452`) is the daemon's
  transport. And Breve and warble hit the same server with no scope key at all.
  **No scope key ⇒ no cache entry.** That is the only rule that is safe for the two clients rotli
  does not control.
- **One live entry, evicted at turn end, on abort, and on a TTL.** The wire is one independent
  `ureq` POST per step with no session and no teardown; a turn can end by user abort
  (`chat.rs:545-547`), the 120 s `CHAT_TIMEOUT` (`chat.rs:28`), or the two-strike `break`
  (`src/ai/loop.ts:186`) — **none of which sends the server anything**. An explicit end-of-turn
  signal will be missed too often to be the only mechanism, so a background reaper keyed off
  last-touch is required, mirroring `_idle_watch` (`mlx-server.py:107-121`). Note that
  `_idle_watch` frees only the model, so a module-level cache would otherwise survive idle
  unload — ~1 GB of KV resident with no model loaded.
- **"Turn end" for a hybrid turn** means the outer `final` of `runHybrid`, not the end of any
  inner leg. Evicting per leg silently disables the cache for the fallback leg (a perf miss that
  would be misdiagnosed as "the cache doesn't work"); not evicting per leg is a leak.

Both harnesses (`scripts/eval-local-chat.ts`, `scripts/eval-vault-sweep.ts`) are in this PR's file
list, because they must send the scope key or they measure a path that does not ship.

**Proof.** All required together, and expressed in **reuse ratio, not wall time** — the instrument
PR 4 built, because ms carries a conceded ~6–20% noise band and cannot see reuse at all:

- **(a)** Deterministic-lane verdicts unchanged or better vs the PR 1 baseline (with the caveat
  that cached prefill changes float reduction order, so this is a noise-band comparison).
- **(b)** `Σ cached_prompt_tokens / Σ prompt_tokens ≥ 0.6` over a turn. The reported measurement is
  ~81%; 0.6 is deliberately conservative.
- **(c)** `cached_prompt_tokens[step n] ≥ prompt_tokens[step n-1]` for all n > 1 — the mechanical
  form of "step-2+ prefill no longer scales with total prompt length."
- **(d) Isolation, asserted mechanically over the whole suite, not hand-probed once:**
  `cached_prompt_tokens == 0` on the first generation of every new chat, **and** across a vault
  switch, a chat close, and a secure-taint flip, **and** whenever the model differs from the
  stored entry's model. Plus a **pure unit test on the cache-key derivation** — a privacy
  invariant must not be proven by a performance observation.
- **(e) Both lanes.** Bars (b)/(c)/(d) re-run against `_run_stream`, **including an
  abort-mid-stream case**, because the abort path is a stream-only way to leave a
  prompt+partial-generation cache behind that guarantees a full re-prefill next step.
- **(f) Memory.** Peak RSS delta reported alongside the prefill win, with the per-entry figure
  (~0.9 GB measured at a 5k prompt) stated and bounded to one live entry.

**Risk.** This is the security-critical PR. rotli's prompts routinely carry secure-note bodies and
secret-shaped text, which `egress_allowed` (`chat.rs:424-437`) deliberately permits to reach a
**local** endpoint — precisely where this cache lives, inside the loopback boundary where no
egress check looks. The realistic exposures are a local timing oracle and secure-note KV state
staying resident past turn end, rather than direct cross-client content disclosure (a prefix cache
returns state only for tokens the caller itself supplied) — but "realistic exposure is narrow" is
not a reason to key it loosely. Nothing in this PR adds a destination, rides a transcript, or
touches `endpoint_permitted` / `egress_allowed` / `model_is_local`.

---

### PR 7 — Cold decisions; stop building the knowledge map twice

**What.** Two pure-waste removals.

**(a) Sampling.** The loop never chooses sampling parameters — `CompleteReq` carries only
`messages` + `formatJson` (`src/ai/types.ts:58-62`) and `host.ts`'s `wireOpts` omits temperature
and `maxTokens`, so everything lands on `temperature 0.4` / `1024`
(`src-tauri/src/chat.rs:288-289`). The plumbing already exists end to end
(`src/lib/tauri.ts:401-416`); `src/ai/verify.ts:33` is the only caller that uses it. Send
**near-zero temperature on the step generation**.

**A correction that changes this PR's mechanism from an earlier draft:** there is **no separate
answer path** to give a different setting to. There is exactly one generation per step
(`src/ai/loop.ts:132-137`) and its output is classified only *afterwards* — the streaming extractor
may declare it a final (`loop.ts:150-153`) or `parseAction` may return `{kind:"final", text}`
(`loop.ts:155-158`, `src/ai/parse.ts:51-53`). The prompt explicitly tells the model to answer from
inside that same step (`src/ai/prompt.ts:246`, `:157`). The only genuinely separable site is
`forceFinal` (`loop.ts:251`, the `proseIsFinal` call), and that is the *fallback* path, not the
answer path.

Therefore: **the token cap stays at 1024 or rises — it is not lowered.** A ~120-token "tool
decision" cap would silently chop every normal final answer the model produces. Near-zero
temperature is applied to the step generation with the written acknowledgement that it therefore
also applies to normal finals; `forceFinal` remains the one site that may take a distinct warmer
temperature and larger cap.

**(b) The double map.** A zero-hit search triggers a second 8000-char knowledge-map build inside
the tool observation (`src/ai/tools.ts:255-262`) when `loop.ts:80` already fetched one for the run.
Reuse it.

**Proof.** For (a), four counters from one deterministic-lane run, all required to move the right
way: malformed/unparseable steps, duplicate-call strikes, **truncations (`finish_reason == "length"`,
from PR 4)**, and verdicts flat-or-up. **Clean falsifier: if the malformed count does not fall,
temperature was not the cause — revert, do not tune.** For (b), separately falsifiable: the
`knowledgeMap` call count per run drops 2 → 1 on any case with an empty search.

**Risk.** Temperature near zero is not free — it can push a 4-bit quantized model into degenerate
repetition, which burns the token cap and reads to the user as a hang. The `decide` and `identity`
cases are watched independently and a drop on either blocks regardless of the aggregate. Also,
**every lane must be explicit**: where rotli is silent the *server's* default of 0.7 applies
(`mlx-server.py:306`), not Rust's 0.4, so a partial change silently hands some path a temperature
nobody tested. Both eval harnesses hardcode 0.4 to mirror `chat.rs` and are updated in this PR or
they stop mirroring reality.

---

### PR 8 — Spend the recovered prefill on grounding

**What.** This is where the budget gets spent, and it is spent on the lever class the repo's own
history says actually moves a 12B. Both items live in the **cached prefix**, so post-PR-6 they are
paid once per turn instead of up to six times.

- **Two worked ReAct trajectories** in the gemma prefix — a full search → area-index read → final
  trace, and a two-part question. `src/ai/prompt.ts` currently has inline BAD/GOOD answer exemplars
  (`:154-160`) but no complete trajectory. This targets the documented F3 satisficing class
  directly and is the highest-reliability instruction-following lever for a model this size.
- **A measured sweep of `maxIndexChars` and `readNoteChars`** (`src/ai/budget.ts:80-89`) against
  the counters the sweep already records. The retrieval notes state the map budget measurably
  changes outcomes for identical questions (`:133`), and that ~a quarter of notes truncate on read
  at 6000 (`:32-34`, `:187-193`).

**Proof.** `truncations` down; `readBeforeFinal` up on enumeration cases; verdicts up by more than
PR 1's published noise floor; and — the axis-3 half — per-turn prefill tokens must stay within a
pre-declared budget of the post-PR-6 figure, since a bigger prefix is only affordable because it
is cached.

**Risk.** `readNoteChars` is not free: `src/ai/loop.test.ts:293-297` pins
`maxScratchChars >= 2 * readNoteChars + 2000`, coupling it to PR 5's append-time cap — raise them
together or the pin fails. And the better-evidenced version of the map lever is **shape, not
size** (serial-area compression freeing ~40% of the budget, and `role: "area-index"`, which took
roster 0/2 → 2/2, `docs/design/local-model-retrieval-notes.md:270-278`). That is retrieval-stack
work, deliberately deferred so a retrieval win cannot be miscredited to a loop change — but it
means the *size* sweep here may return less than the shape work would, and we should not be
surprised by that.

---

### PR 9 — Carry the model's own reasoning forward

**What.** The one reasoning bet. Both adapters require a `"thought"` on every step
(`src/ai/prompt.ts:139`), the model pays tokens, time and heat to write it, `parseAction` reads
only `final`/`tool`/`args` (`src/ai/parse.ts:51-60`), and `ScratchStep` carries only
`{action, result}` (`src/ai/types.ts:119-122`). The prompt even instructs the model to *shorten*
its reasoning to cut latency (`:157`). Carry it: `ScratchStep` gains a `thought`, `parseAction`
returns it, `renderScratch` renders it as the model's own prior reasoning. **Zero extra
generations by construction.**

Folded in here in its only cache-safe form: the **remaining-steps counter**, written once into
each appended step block (`after this, N steps remain`) and never rewritten. That preserves the
strict-prefix invariant while still telling the model where it stands.

Two constraints this PR must satisfy that an earlier draft got wrong:

- **Defuse thoughts too.** The draft argued thoughts are model-authored and therefore safe
  unfenced. But the model's output is exactly what a hostile note is trying to steer — the channel
  is note body → model → thought, with only a prompt sentence (`UNTRUSTED_DATA_RULE`) in between.
  Today the only model-authored free text re-entering the prompt is `raw.slice(0, 160)` on an
  unparseable reply (`src/ai/loop.ts:171`) — 160 chars, on a failure path; on the normal path
  `action` is `` `${tool} ${JSON.stringify(args)}` `` and `JSON.stringify` escapes newlines, so a
  line-start keyword is unreachable. This PR would make free text a full field on **every
  successful step**. Run `defuse()` over thoughts (it is a zero-width marker, invisible to a human
  reader, and does not disturb the prefix invariant), keep them **outside** the `<result>` fence,
  keep results fenced, and pin the shape in `prompt.test.ts`.
- **Budget them.** `pruneScratch` sums only `e.result.length` (`src/ai/tools.ts:176`), so `action`
  already escapes the budget and `thought` would be a far larger second escapee — a thought is
  bounded only by the 1024-token cap (~4k chars), and the prompt actively encourages long thoughts
  on tool steps ("Save the real reasoning for the steps where you pick a TOOL", `:157`). Include
  `thought` and `action` in the total, or cap thought length at append time, and report the
  resulting `promptChars` delta.

**Proof.** Verdict distribution must improve by **more than PR 1's published noise floor**, at
flat-or-lower mean generations-per-turn, with `readBeforeFinal` rising on enumeration cases. PR 5's
token-prefix property test must stay green — that is the mechanical guard on the reconciled
counter. **Kill criterion, declared in advance: if the verdict delta does not clear the noise
floor, this PR is CLOSED, not tuned.** The repo's own history argues for that discipline;
prompt-shaped quality work has repeatedly bought margins too small to see, and the failure mode is
endless plausible tinkering.

**Risk.** Beyond the two above: telling the model its remaining steps could make it give up early
rather than answer better. Watch for falling mean steps accompanied by falling verdicts — that is
the wrong kind of cheaper.

**2026-08-08 web-research slice.** The carry-forward mechanics above are now
implemented: thoughts are parsed, capped, scratch-budgeted, defused on re-entry,
and paired with an append-only remaining-step snapshot. Gemma's web prompt also
names a five-stage evidence workflow (inventory, exact extraction,
reconciliation, claim ledger, grounded answer/abstention). A deterministic
date/time/timezone-pairing check conditionally requests correction; the normal
path still uses two generations. This validates the observed web-grounding
failure class, not the broader vault-retrieval verdict threshold in this PR's
kill criterion; that wider claim still requires the full sweep.

---

## Privacy and security invariants

None of this may weaken rotli's egress or secure-note rules. Restated so a reviewer can check it
in one place:

- Nothing here touches `endpoint_permitted` (`src-tauri/src/chat.rs:393`), `egress_allowed`
  (`:424`), or `model_is_local`. No new destination is introduced. The cache, the thermal probe and
  the version probe all sit on loopback or in-process.
- The loop's egress guard (`src/ai/loop.ts:193-214`, `looksSecret` +
  `containsPrivateDataOverlap` on `EGRESS_TOOLS`) is untouched. No PR here composes private scratch
  text into an off-device tool argument, and no new tool is added. Standing gotcha: a new
  `ToolName` must be classified in `scripts/check-security.mjs`.
- The prompt cache is the one genuinely new privacy surface, because `egress_allowed` deliberately
  lets secret-shaped text reach a local endpoint. Its key, eviction, fail-closed rule and isolation
  proof are specified in PR 6 and are gating, not advisory.
- Untrusted-data fencing survives PR 9: results stay inside `<result>` and defused
  (`src/ai/prompt.ts:88-100`); thoughts get defused too but stay outside the fence; the shape is
  pinned by `prompt.test.ts`.

---

## Open questions

Things we genuinely do not know. Each is an experiment, not an argument.

1. **Does `thermalState` ever reach `serious` or `critical` during real rotli use?** We have
   observed `nominal` at rest and `fair` under agent load — never worse. If the interactive path
   never leaves `nominal`/`fair`, then a thermal *gate* would be either inert or a permanent block,
   and the honest answer is that rotli has no actionable heat signal. **This is the re-entry
   condition for any thermal budget dial, and PR 2 is the instrument that answers it.**
2. **Is `thermalState` early or late?** It is the OS's coarse verdict, not a temperature. If it
   moves only after the machine is already throttling, it is a tripwire and not a meter, and the
   honest heat proxy remains generations-per-turn × tokens generated.
3. **Does the snapshot-before-decode cache actually reuse on the streaming path after an abort?**
   The buffered path is easy; the stream path's hang-up teardown is the one we expect to be
   fiddly, and it is the shipped default.
4. **How much does the chat template tail actually cost?** We know the single-user-message wire
   shape makes the full sequence non-prefix. Snapshotting before the tail should make that
   irrelevant, but the tail is a handful of tokens re-prefilled per step — measurable and probably
   negligible, unmeasured today.
5. **Does cold sampling degrade prose?** We predict fewer malformed decisions. We do not know what
   near-zero temperature does to answer quality on this 4-bit model, and since there is no separable
   answer path (PR 7), this applies to real answers. If the `decide`/`identity` cases drop, the
   answer is no.
6. **What is the actual noise floor?** Unknown until PR 1 runs `--repeat 5`. It is entirely possible
   that some cases already flip run-to-run — in which case several historically recorded PASS/FAIL
   claims in existing notes are weaker evidence than they read as.
7. **Who owns `mlx-server.py`?** Breve and warble consume it. PR 3 makes rotli the de-facto owner of
   the vendored lane. That is a product decision for the maintainer, recorded here rather than assumed.
8. **Is the counterfactual defect-trigger rate low enough for a re-check to be worth building?**
   PR 1 answers it for free. Low ⇒ a defect-gated re-check has known expected value and is worth a
   PR. High ⇒ the gate is wrong, not the model, and the PR would have been a redesign.

---

## Deliberately not doing

**Parked, not rejected — research:** *third-party agent harnesses (opencode, pi).* the maintainer parked
these himself, and the measurement explains why they would not have paid here: **the gap is loop
COST, not loop SHAPE.** No harness would have found the prefill problem, because it lives in the
model server, below where a harness sits. If a harness is revisited, the question to ask it is
whether it brings *retrieval* or *constrained decoding* — not whether it brings a better loop.

Rejected, with reasons:

| Rejected | Why |
|---|---|
| Wiring a stock prompt cache without the append-only work | Measured 8% net regression, zero reuse. `RotatingKVCache` makes the trim path permanently dead past 1024 tokens, so a non-prefix prompt returns a full re-prefill. The single most important rejection here. |
| `${remaining}` substituted at `src/ai/prompt.ts:175` | Per-step-varying text in the stable prefix. Would have silently disabled the stack's biggest win while looking costless. Survives only in PR 9's append-only form. |
| Always-on reflection, self-verification, self-consistency, best-of-N | Multiplies generations unconditionally on a serialized slot, queueing in front of the user's next message. And the improvement would be scored by keyword matching that cannot tell a better answer from a more verbose one. |
| A defect-gated re-check as a shipped PR | Deferred with a cheap re-entry condition: PR 1 records the counterfactual trigger rate at zero generation cost. Decide with data, not argument. |
| An adaptive step-budget classifier keyed off the question | `RunInput.maxSteps` is fully plumbed (`src/ai/loop.ts:66`) and no app caller sets it — tempting. But a misclassified question produces a visibly worse answer in the user's face, and post-cache an avoided step saves a few hundred ms instead of ~14 s. The win shrinks by an order of magnitude while the risk stays constant. |
| A thermal-aware step budget, or any thermal check on chat admission | Trades axis 1 for axis 3, backwards against the maintainer's ordering; post-cache the heat it would save is largely gone; and it would mix a MEMORY-verdict queue with a QUALITY dial, making the guardrail lie about why someone is waiting. Re-entry: Open Question 1. |
| Constrained JSON decoding via `logits_processors` | Genuinely harness-grade — malformed replies become structurally impossible. But PR 7's cold sampling should capture most of it without a second decode-path change to a shared runtime. Reconsider only if PR 7's malformed-step counter does not reach ~zero. |
| Speculative decoding with a draft model | Speeds *decode*, the smaller half of a tool step, and needs a gemma-3-family draft sharing the tokenizer — none installed (only `qwen2.5-1.5b/3b` beside `gemma-3-12b`). Second-order behind prefill by a wide margin. On the record so it is not discovered late. |
| Fixing the compute guardrail's phantom same-model concurrency, and ticketing the daemon's local calls | Both are real honesty bugs — `mlx-server.py`'s `_lock` is held for the whole generation, so two admitted same-model turns serialize inside Python while the queue says "running", and `docs/design/local-compute-guardrails.md:103-106` asserts the opposite. Neither moves the maintainer's three axes, and folding them in would muddy this stack's proof story. Own PR, against the guardrails doc. |
| Warm-on-intent (`/warmup` on composer focus) | Cheap and real — the model unloads after 600 s idle and only Breve ever warms it — but a one-off cold-load papercut, not a per-turn cost. Papercut batch. |
| A bigger or less-quantized local model | 7.5 GB resident already, and a swap is a full unload/gc/reload. A larger model raises prefill roughly linearly — the dominant term in both complaints. Wrong direction. |
| CI-gating the live evals | CI has no MLX server and no vault; `regression.yml` runs only the offline suite. `docs/design/ai-visibility-matrix.md:291-293` already asserts a release gate nothing enforces — wire it into `release.sh` as a **local** pre-release step or delete the claim, but do not restate it as a CI promise this project cannot keep. |
| A cross-turn read-trail (the F4 fix) | Plausible and cheap, but PR 9 is already the stack's one unproven prompt-shaped bet with a kill criterion. Two at once makes neither attributable. |
| Another retrieval pass (ranking, richer metadata) | Historically the highest-value area — roster went 0/2 → 2/2 on retrieval metadata — but it has its own stack (Tantivy, PRs #47/#48). Mixing it in would let a retrieval win be miscredited to a loop change. |

---

## Related documents

- `docs/design/local-compute-guardrails.md` — the memory admission model this doc sits on top of.
  Note it also needs an amendment: its worked example at `:103-106` ("several concurrent same-model
  turns fit") is contradicted by the server's process-wide generation lock.
- `docs/design/local-model-retrieval-notes.md` — the measured failure taxonomy (F2–F5) and the
  baseline table this plan is scored against.
- `docs/design/ai-visibility-matrix.md` — what each class of model may see; the secure/locked rules
  the cache must not weaken.
- `docs/design/cross-platform-feasibility.md:111` — the power/thermal probe seam and its permissive
  non-macOS fallbacks.

Both this file and `local-compute-guardrails.md` must be routed from `docs/README.md`; PR 1 adds
both rows.
