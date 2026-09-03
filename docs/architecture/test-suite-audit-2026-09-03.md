# Test suite and tooling audit — 2026-09-03

Three lanes ran in parallel on the tree at `dev` = #141: CI/proof-chain parity,
test coverage against the last two weeks of changes, and lint/format/typecheck
configuration. Everything below was measured, not assumed. Items marked FIXED
landed in the same-day batch; the rest are recorded decisions or follow-ups.

## 1. Proof chain (verify ↔ CI ↔ release)

| Finding | Status |
| --- | --- |
| `verify` skipped six CI steps: frozen installs (app, Breve defaults, site), `deps dedupe-check`, `deps licenses-check` | FIXED — quality lane runs them first |
| The chromium check could not fail (a lane that cannot run read as passed) | FIXED — blocking, with the install command |
| A stale `vite dev` on :1420 would make Playwright prove the wrong build | FIXED — warned |
| `release.sh` looked up CI as "the newest 40 main runs"; a just-finished run was missed twice | FIXED — `--commit` lookup, 5 bounded retries, cancelled runs ignored, `origin/main` ancestry asserted |
| Playwright: `fullyParallel` configured but one worker granted; 103 specs ≈ 6 min | FIXED — 4 workers on CI, `github` reporter names retried specs |
| `antigravity.rs` test set `$HOME` process-wide (races every other test) | FIXED — `runtime_env_in(profile, bin)` seam |
| Coverage "ratchet" used `Math.min`: a directory could only sink | FIXED — `Math.max`; recorded ratio is the floor |
| Two Breve runtime tests existed on disk but were in no lane | FIXED — `check:structure` asserts the `test:breve` list |
| 20 `cfg(not(target_os = "macos"))` blocks compiled by nothing | FIXED — `rust-linux-check` job (`cargo check --all-targets`) |
| Playwright browsers and `cargo-audit` reinstalled every run | FIXED — cached |
| `cargo test` runs only on the macOS lane | OPEN — by cost; a macOS runner outage drops ~440 assertions silently |
| `cargo fmt` | NOT ADOPTED — re-measured decision in CONTRIBUTING stands |
| The site's prerender chunk imports `clsx` by bare specifier; bun's isolated linker leaves no `site/node_modules/clsx`, so Node walked up to the app's `clsx@1` (no named export) and the local site build died the moment `verify` did a real `bun ci` there | FIXED — the site declares `clsx` directly (a devDependency), so the specifier resolves inside the site on every machine |

## 2. Coverage against 2026-08-19 → 2026-09-03

Covered well: merge/conflict paths, tables, result/choice grammars, pending
tabs, the relay, the six theme families, Breve PDF palettes, render-document.

| Gap | Status |
| --- | --- |
| Provider policy test named "claude, codex and cursor" while admitting Antigravity; Antigravity argv/effort/tier/image refusals and cross-lane model leakage unasserted | FIXED — renamed and pinned |
| `services/antigravity.ts` and the appearance broadcast loop untested | FIXED — `antigravity.test.ts`, `appearanceSync.test.ts` (loop extracted as `startAppearanceBroadcast`) |
| The 0.85 stale-payload bug (accent/quokka/time format) and "Black → Auto" line colour had no failing twin | FIXED — asserted by name |
| Settings → AI Models had no e2e after two commits touched it | FIXED — `e2e/ai-models.spec.ts` |
| `chordFromEvent` platform independence (what every Linux e2e leans on) unpinned | FIXED |
| Source-shape ratchet counted `readFileSync(new URL(` reads (27), not assertions (~184); line-wrapping evaded it | FIXED — counts assertions; baseline 178 |
| Permanent-negative shape pins (`not.toContain("CoffeeGlyph")`…) and a source-sliced quick-note test duplicating behavioural coverage | FIXED — retired |
| Two files carried raw NUL/`\x01` bytes: git diffed them as binary, grep skipped them | FIXED — escaped; `check:code-shape` rejects control bytes |
| Duplicate test titles in three files | FIXED |
| `e2e/svg-sanitization.spec.ts` pressed `Meta+Home` (CodeMirror mac-only; a no-op on Linux) | FIXED — programmatic scroll; guard added |
| Breve health strip WARN state, Quick Note window, hotkey rebinding, boards, sheets/docx editing, onboarding, palette action execution have no e2e | OPEN |
| `tableRender.ts`/`tableMenu.ts` are e2e-only | OPEN |
| Evals do not cover the Antigravity/Cursor no-tools override (Rust-only) | OPEN |

## 3. Lint, format, typecheck

| Finding | Status |
| --- | --- |
| `plugins` replaces oxlint's defaults; `unicorn` and `oxc` were silently off | FIXED — on; 25 findings fixed; `no-useless-spread` off by measurement (9 deliberate snapshot iterations) |
| Type-aware rules at ≤7 findings each | FIXED — `switch-exhaustiveness-check` (default counts for unions), `return-await`, `no-deprecated` (Vite `onwarn` → `onLog`, React `FormEvent`), `only-throw-error` |
| No mechanical `localStorage` check (asked for by the 2026-07-29 audit) | FIXED — `no-restricted-globals`, one listed exception |
| `scripts/*.ts` typechecked by nothing; two real errors hiding | FIXED — `tsconfig.scripts.json` in `typecheck` and `typecheck:tsc6` |
| Formatter missed `scripts/**/*.mjs` and `vite.config.ts` (15 of 28 drifted) | FIXED — scope widened in package.json, toolchain policy, and the pre-commit hook (which also gained `services/`) |
| `lint:oxlint` raced a failing `typecheck`; tsgolint's crash buried the real error | FIXED — runs after the parallel group |
| 12 `var(--x)` tokens used but never defined (dead transition, empty focus ring, missing radius) | FIXED — mapped to real tokens; `--font-mono` defined; guard added |
| Rust had no local `[lints]`; local clippy was laxer than CI | FIXED |
| `knip --production` reported 32 false "unused dependencies" (no production entries) | PARTLY — entries marked; the production run is now honest and reports 26 test-only exports + 4 types. Not gated yet; that debt list is the follow-up |
| `no-await-in-loop` (145, mostly sequential IO) | REJECTED |
| `jsx-a11y` (~150; the two keyboard rules matter most) | OPEN — needs its own decision |
| `no-console` in `src/` | OPEN — measured at 4 sites |

## 4. Not provable locally

Antigravity sign-in, its per-account model list, and a real turn still need a
signed-in Mac. The Finder drag preview and drop cannot run under Playwright.
