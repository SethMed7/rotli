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

The full inventory — every ureq / fetch / network-CLI call site with its
destination class and guard — is tracked in
[`../../scripts/fixtures/egress-allowlist.json`](../../scripts/fixtures/egress-allowlist.json).

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

## Reported, not fixed — maintainer decisions

These findings from the 2026-07 audit are **product-behavior-changing** or need
a design project, so they are documented here rather than silently changed:

1. **`assetProtocol.scope` is `$HOME/**`** (high). Any file under `$HOME`
   (`~/.ssh`, other apps' data, the gitignored memex `storage/`) is servable into
   the webview; `frame-src asset:` even renders local files in an iframe. The
   runtime `allow_directory(store.root())` already scopes the active root at
   connect, so the static `$HOME/**` is redundant breadth. **Recommended fix:**
   narrow the static scope to empty (or a corpus-agnostic minimum) and rely on the
   runtime allow, and consider dropping `asset:` from `frame-src` if boards/viewers
   don't iframe local files. Left as a decision because it can affect asset
   rendering; `check:security` pins the current scope so it can't widen unnoticed.
2. **safe-fetch DNS-rebinding TOCTOU residual** (medium). The TS side resolves +
   vets the host, then Bun's `fetch()` re-resolves at connect — a hostile low-TTL
   record could differ. Rust closed the identical gap with `vetted_resolve`. The
   fix needs a custom Bun dispatcher / connect-by-IP with Host+SNI handling — a
   build project, not a check. Narrow window on a single-user Mac; the realistic
   vector is a poisoned user-configured watchlist entry.
3. **Send-seam secret scan is text-only** (low). `egress_allowed` scans message
   text but not base64 image attachments; a screenshot of a secure note attached
   in the composer would ride to the Gemini lane unscanned. Images are
   user-attached (an explicit act), so this is a consented gap. Options: refuse
   image attachments to non-local endpoints, or scan EXIF/text chunks only. The
   promise is precisely "**text-shaped** secure content never leaves."
4. **generate_image nested-agent privilege** (partially mitigated). The agy lane
   runs `--dangerously-skip-permissions`; the prompt is now framed as data, but a
   fuller fix is per-chat opt-in + a sandboxed/no-network agy profile matching
   codex's `workspace-write`. Tracked for a build phase.
5. **Non-secret private prose via web tool args** (partially mitigated). The
   only egress gate on web args is the secret detector; ordinary private prose can
   still ride a model-authored URL. Bounded by globe-default-off, the URL length
   cap, secure-note exclusion, and step caps. A content-overlap egress check
   (web args vs recently-read notes) belongs next to `looksSecret` in `guard.ts`
   with a `secret.rs` mirror — a build project.

### Supply-chain advisories (transitive-only, tracked)

All from `bun audit` / rustsec, none in rotli's own `src/`:

- **lodash-es** ≤ 4.17.22 (high, code injection via `_.template`) — via Univer,
  Mermaid, Excalidraw. Reachable only if those libs call the vulnerable APIs on
  attacker-influenced input (plausible for Mermaid diagram source).
- **nanoid** < 3.3.8, **uuid** < 11.1.1 (moderate) — library-internal ID gen via
  Excalidraw/Univer/exceljs/Mermaid.
- **esbuild** dev-server file read (low, Windows-only, build-time) — via vite.
- **onnxruntime-web** pinned to a dated dev-prerelease tag (availability risk).

Pick these up on the next bump of Univer / Excalidraw / Mermaid / exceljs / vite.
The `dependency-audit` CI lane is **advisory** (`|| true`) so upstream churn we
don't control doesn't block merges; promote it to blocking once the tree is clean.

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
