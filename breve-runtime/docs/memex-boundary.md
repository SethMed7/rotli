# The memex boundary — why Rotli's brief runtime mirrors, never imports

*The architectural line between Breve (the assistant) and the memex (the knowledge).
Lives in `scripts/config.ts`.*

## The rule

**The embedded brief runtime has NO code dependency on the memex implementation.** Rotli owns and
supervises the runtime, while the knowledge base is resolved by **path at runtime**
(`config.local.json` → `knowledgePath`, default `~/memex`) and may be absent on a fresh install.
Everything the runtime reads about the memex —
the partition registry, the access mode, the instance identity — it reads by *opening files*, not by
importing memex code.

```
Rotli (.rotli/breve)         memex corpus
  config.ts  ──reads files──►  users.json · identities.local.json · memex.json
  (mirror of the contract)     MAP.md · self/ · wiki/ · history/ · inbox.md
```

## Why mirror instead of `import`

`config.ts` deliberately **re-implements** the small slice of `memex/scripts/mounts.ts` it needs
(`readMemexRegistry` / `accessMode` / `knowledgePathFor` / `memexInfo`). It does **not** import
mounts.ts. The header comment says why, and it's load-bearing:

> DO NOT "DRY this up" by importing mounts.ts — that re-introduces module-load coupling and crashes
> Breve when the memex is missing or its engine has drifted.

So the duplication is intentional: it keeps the runtime runnable when the memex is absent or on a different
contract version. The cost is that the mirror must be **kept in sync by hand** when the memex's
*file-format* contract changes.

## What's mirrored (keep byte-identical to mounts.ts)

- **`users.json` shape** — `{ primary, mode, auth, users[] }`; multi-tenant partition resolution
  (`knowledgePathFor(user)` → base, declared `path`, or the `users/<name>` convention).
- **`accessMode()` fail-closed table** — no registry ⇒ `local`; a registry with no explicit mode ⇒
  `secure`; any malformed/typo value collapses to `secure`. This must stay identical to mounts.ts so a
  corrupt mode can never silently disable the step-up gate (FORGE M3).
- **`memex.json` pinning** — Breve reads the instance `id` + `contract` so a swapped/wrong memex is
  noticed before it's trusted.

## Maintenance rule

When `memex/scripts/mounts.ts` changes the **users.json / mode / memex.json** format, update the
mirror in `config.ts` in the same change — this is the *one* place the contract is duplicated, on
purpose, by value. (Behavioral/feature logic still lives only in Breve; the memex never fetches,
sends, or calls an LLM — it only declares structure + config.) See the memex's `STRUCTURE.md` for the
authoritative contract.

## Breve holds no durable knowledge

The flip side of the boundary: **Breve is logic over the memex, so its durable *outputs* belong in the
knowledge layer, never in the managed runtime.** A brief is an output, not a record the runtime owns.

- **The record → the memex.** `scripts/daily-log.ts` distills each day (Breve's briefs + the Signal
  conversation) into a digest at `<memex>/history/<YYYY>/<date>.md` — *what was surfaced and engaged*,
  not the brief verbatim. It runs from the night wrapper and is idempotent/re-runnable.
- **Binaries → your storage.** Rendered PDFs/audio/PNGs/topic deep-dives live in the asset store (`brevePDFs/`,
  `breveAudios/`, `breveViews/`, `breveTopics/`) — the text spine stays text-only; the asset store holds the renders.
- **`.rotli/breve/briefs/` aliases Rotli's canonical brief library.** Markdown stays permanently
  searchable in Rotli. The in-day pipeline reads today's companions; `daily-log.ts` prunes only stale
  HTML/audio/suggestion files after their durable renders have landed in storage.
- **What stays in `.rotli/breve`:** versioned runtime code, private local wiring (`config.local.json`,
  `*.json` PII), and
  ephemeral operational state — logs (`logs/`), the today-cache. That's the only category that lives here.

So the rule is symmetric: the **memex** holds no logic/LLM calls; **Breve** holds no durable knowledge.
