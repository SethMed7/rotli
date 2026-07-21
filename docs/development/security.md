# Security layer

Privacy is the product. Rotli is local-first: secure notes fail closed, remote
models never see secret-shaped content, and secrets live only in the Keychain.
This document is the map of how data leaves the machine, the mechanical guards
that keep it that way, and the residual risks a maintainer still owns.

## Threat model in five sentences

The adversary is untrusted **content** — a note, an imported capture, a fetched
web page, or a chat memory — that reaches the on-device model and tries to steer
it into exfiltrating private data or running code. The single-user Mac itself is
trusted; a fully compromised webview or a hostile local process is out of scope
except where a cheap guard closes the gap anyway. The assets worth protecting
are the memex's private prose (journals, health, people, business plans),
secret-shaped strings (keys, tokens, PANs, SSNs), and the Keychain credentials.
The defenses are layered: secret detection at every send seam, endpoint-locality
gates so remote models never receive secure content, an SSRF-hardened fetch
path, a destination clamp on the model transport, and prompt-injection framing
so tool results are data and never instructions. `check:security` is the
tripwire that keeps a future change from silently widening any of these.

## The egress map (destination class → data → guard)

| Path | Destination | Data | Guard |
|---|---|---|---|
| `web_fetch` | arbitrary public web | model-chosen URL text | secret scan + `vetted_resolve` IP-pinned SSRF block + same-host redirects + 2 MB / 2048-char caps (fixtures) |
| `web_search` | duckduckgo.com only | query | `protected_for_remote` secret scan |
| `chat_messages` | registered loopback model server **or** the pinned Gemini base | conversation transcript + images | `endpoint_permitted` destination clamp + `egress_allowed` secret-shaped refusal to non-local endpoints; local llama.cpp Bearer never rides to a remote base |
| `generate_image` | OpenAI/Google via codex/agy CLI | model-authored prompt | `protected_for_remote`; prompt framed as DATA to the nested agent |
| CLI lanes (claude/codex/agy) | Anthropic/OpenAI/Google | transcript | binary+model allowlist (parity-pinned), tool-less/sandboxed argv, secret scan |
| Resend (Rust `breve.rs` + breve-runtime send lanes) | literal `api.resend.com` | brief text | Keychain Bearer (allowlisted names), configured recipients, delivery-claim idempotency |
| signal-cli sends | configured recipients | brief text | delivery-claim contract |
| Breve local-model tier (`llm.ts`) | loopback only | memex/Signal/watcher text + prompts | `llmConfig` throws on a non-loopback endpoint unless `llm.allowRemote` is set |
| Breve safe-fetch | curated public hosts | watchlist/summarize URLs | `safe-fetch.ts` (https-only, SSRF block, same-host redirects, caps) |
| YouTube probes (`signal-daemon.ts`, `creator-alerts.ts`) | literal `youtube.com` | handle/channelId in the path/query only | host-pinned literal, `checkUrl`-gated |
| Updater | GitHub releases | — | minisign-signed feed, single pinned HTTPS endpoint |
| ImapFlow (`mail.ts`) | configured mail hosts | — | TLS strict except loopback |
| Webview | nothing | — | CSP `connect-src ipc:` only; no fetch/XHR/WebSocket in `src/` |
| `rotli` CLI / `rotli-workspace` MCP | local Claude/Codex process | requested non-secure note text or compact board data | registered-root discovery + remote-AI secure detector + locked-note refusal + optimistic revision check; stdio only, no network listener |

The full inventory — every ureq / fetch / network-CLI call site with its
destination class and guard — is tracked in
[`../../scripts/fixtures/egress-allowlist.json`](../../scripts/fixtures/egress-allowlist.json).

The workspace MCP server itself performs no network request, but a connected
Claude or Codex process may be remote. It therefore treats every agent as remote:
secure flags and secret-shaped bodies are omitted/refused even when a provider
CLI happens to run on localhost. Board metadata/scenes currently have no secure
classification; users must not place secrets on an agent-managed board.
Agent-visible workspace metrics are computed only after that same note filter and
do not disclose a count of withheld secure notes. `rotli agent doctor` forces a
read-only store, while `rotli agent self-test` uses only a temporary memex.

## The checks and how to run them

`check:security` ([`../../scripts/check-security.mjs`](../../scripts/check-security.mjs))
runs in the `lint` chain (`bun run check:security` to run it alone). It enforces:

- **(a) Egress allowlist.** Every `src-tauri/src` file using the `ureq` HTTP
  client, and every `breve-runtime/scripts` file with a raw `fetch(` (or a
  `node:http/https/net/tls/dgram` import), must be declared in the fixture. A new
  network call site fails until declared. No second HTTP-client crate may enter
  `src-tauri/Cargo.toml`. It also pins that the agent loop's `EGRESS_TOOLS` set
  covers every non-local `ToolName`, so a future off-device tool can't ride past
  the secret guard.
- **(b) Keychain literals.** The two allowlisted account names may appear only at
  their named-constant declaration sites — a hand-typed literal at a call site
  fails; callers import the constant.
- **(c) Platform snapshot.** `tauri.conf.json`'s `csp`, `devCsp`,
  `assetProtocol.scope`, and updater endpoints, plus the default capability's
  granted permissions, are pinned. Widening any of them fails until the snapshot
  is deliberately updated in the same change.
- **(d) Sensitive-logging tripwire (heuristic).** Flags a `println!`/`console.log`
  in an egress-adjacent file whose argument names a body/secret/prompt-shaped
  variable. **Limit:** a renamed variable or an interpolated helper slips it —
  this catches the obvious regression, it does not prove the absence of a leak.

Adjacent, pre-existing guards this layer builds on (run by `bun run check`):
`check:secret-parity` (guard.ts ↔ secret.rs detector parity), `check:parity`
(endpoint-locality + shared constants), `check:breve-contract`,
`check:structure`, and the fixture-driven egress tests on both stacks
(`src-tauri/src/web.rs` `#[cfg(test)]` + `breve-runtime/tests/test-safe-fetch-fixtures.ts`
against [`../../scripts/fixtures/egress-fixtures.json`](../../scripts/fixtures/egress-fixtures.json)).

## Adding a network call (procedure)

1. Prefer an existing seam: web reads go through `web_fetch` (Rust) or
   `safe-fetch.ts` (Breve); model calls go through `chat_messages` or `llm.ts`.
2. If a genuinely new call site is unavoidable, add its file to the right list in
   `egress-allowlist.json` with a one-line **destination class + guard**.
3. If the destination is off-machine, add its adversarial verdicts to
   `egress-fixtures.json` (both test suites consume it) and run
   `bun test ./breve-runtime/tests/test-safe-fetch-fixtures.ts` +
   `cargo test --manifest-path src-tauri/Cargo.toml --lib web`.
4. Run `bun run check:security` and `bun run check`.

## Maintainer decisions — DECIDED 2026-07-18

The 2026-07 audit escalated five product-behavior findings. Disposition:

1. **`assetProtocol.scope` — FIXED (narrowed to empty).** The static scope was
   `$HOME/**` (any file under `$HOME` servable into the webview). It is now
   `[]`: the runtime `allow_directory(store.root(), true)` grant at corpus
   registration is the ONLY asset grant, so every servable path is a registered
   corpus root. `frame-src asset:` stays — the PDF viewer genuinely renders
   via an asset iframe. `check:security` pins the empty scope. *App-smoke on
   next run: images/PDF/video inside notes must still render (they live under
   corpus roots, which the runtime allow covers).*
2. **safe-fetch DNS-rebinding TOCTOU residual — DEFERRED to the quarterly
   review.** The prompt-injectable path (Rust `web_fetch`) is closed with
   `vetted_resolve`; the residual affects only Breve's owner-configured
   watchlist fetches on a single-user Mac, and the fix (a Bun connect-by-IP
   dispatcher with Host+SNI handling) is a build project. Revisit next quarter
   or when Bun ships a dispatcher API.
3. **Send-seam secret scan is text-only — ACCEPTED as a consented gap.**
   Attaching an image is an explicit user act; the product promise is precisely
   "**text-shaped** secure content never leaves" and that promise holds.
4. **`generate_image` agy privilege — FIXED (OS-sandboxed).** The agy image
   job now runs under `sandbox-exec` with a profile mirroring Breve's policy
   as independent enforcement: `$HOME` reads/writes denied except the pinned
   chat-assets dir, the CLI's own state (`~/.gemini`, `~/.antigravity`), the
   login Keychain (read-only, its auth token), and the binary's directory.
   Knob: `ROTLI_IMAGE_SANDBOX=0` disables (Configuration Rule safe fallback).
   *App-smoke on next run: agy image generation still saves its PNG.*
5. **Non-secret private prose via web tool args — DEFERRED, designated next
   security build.** Bounded today by globe-default-off, the URL-length cap,
   secure-note exclusion, and step caps. The content-overlap egress check
   (web args vs recently-read note content) is the next `guard.ts`/`secret.rs`
   pair to build, scheduled with the quarterly review.

### Supply-chain advisories (transitive-only, tracked; reviewed 2026-07-21)

All are outside Rotli's own `src/`. The current `bun audit` reports nine findings:

- **lodash-es** ≤ 4.17.22 (two high/moderate families: template-key code
  injection and prototype pollution) — through Univer, Mermaid, and Excalidraw.
- **brace-expansion** 2.0.0–2.1.1 (high exponential-expansion DoS) — through
  ESLint/typescript-eslint build tooling and exceljs's archive path.
- **nanoid** < 3.3.8 and **uuid** < 11.1.1 (moderate) — library-internal ID
  generation through Excalidraw, Univer, Vite, exceljs, and Mermaid.
- **esbuild** 0.27.3–0.28.0 (low, Windows dev-server arbitrary file read) —
  through Vite; Rotli's shipped macOS bundle does not expose the dev server.

RustSec found two unsound dependencies in the July 21 run. **anyhow 1.0.102** is
fixed in Rotli's lockfile at 1.0.103. **glib 0.18.5**
(`RUSTSEC-2024-0429`) exists only in Tauri 2.11's Linux GTK3 target graph
(`tauri → tray-icon/webkit2gtk → gtk/glib`); it is absent from the shipped macOS
graph and has no compatible patched GTK3 release. The audit ignores that exact
ID while retaining the dependency path here; Tauri's eventual Linux GTK4 move
is the removal path. RustSec also reports 16 unmaintained warnings in that Linux
GTK3/UNIC graph.

The `dependency-audit` CI job is deliberately advisory. `continue-on-error` is
set on both scanners, while `checks: write` lets RustSec publish its check report;
the missing permission—not an audit finding—was what made regression runs fail
through 0.33.2. Promote the lane to blocking after upstream updates clear the
tracked tree.

## Quarterly AI security review

Re-run this audit each quarter (or before any release that adds a network call,
a new tool, or a new provider lane): re-derive the egress map from a fresh
call-site scan, diff it against `egress-allowlist.json`, re-run `bun audit` +
rustsec, and re-verify the secret-detector parity and endpoint-locality fixtures.
Record the date and the delta at the top of this section.

- **2026-07** — initial layer: `check:security`, egress-allowlist fixture, the
  chat.rs destination clamp + Bearer-locality fix, corpus file-lane traversal
  guards, prompt-injection framing, the Breve loopback-only gate, and CI audit
  lanes.
