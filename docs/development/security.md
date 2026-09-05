# Security layer

Privacy is the product. Rotli is local-first: secure notes fail closed, remote
models never see secret-shaped content, and secrets live only in the Keychain.
This document is the map of how data leaves the machine, the mechanical guards
that keep it that way, and the residual risks a maintainer still owns.

## What each class of model may see and change

Two independent controls, on two axes (the maintainer, 2026-08-01):

- **`secure` is a VISIBILITY control against remote.** A frontier/API model
  never receives a secure note's title, snippet, body, or search hit. An
  on-device model reads them by default; the note's `local_ai_allowed` and the
  vault's `secureLocalAi` can withdraw that. No knob opens one to a remote model.
- **`locked` is an EDIT control.** No AI of any class edits a locked note.
  Every class still reads it.
- The brain's memory lanes (`identity/`, `personality/`, `history/`, `MAP.md`,
  `inbox.md`) are retrievable by both classes through the AI's search / map /
  read tools, and writable by none.

Both layers enforce all of the above independently: TypeScript fails fast, Rust
is the authority, and neither trusts the other. The matrix, the enforcement map
per seam, and the threat cases are in
[`../design/ai-visibility-matrix.md`](../design/ai-visibility-matrix.md); the
normative rules stay in
[`../architecture/memex-data-contract.md`](../architecture/memex-data-contract.md).

## Threat model summary

The canonical asset, actor, boundary, abuse-case, and residual-risk model lives
in [`../security/threat-model.md`](../security/threat-model.md). This summary
keeps the egress procedure usable without duplicating that contract.

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

The full-text **search index** (`.rotli/search/`, Tantivy) is a DERIVED,
gitignored, rebuildable at-rest asset that now holds secure-note content (tokens
+ positions). It is not an egress path: `corpus_search` is the user lane, and the
only AI-facing search command re-applies `read_for_ai` per hit in Rust before any
hit leaves, so a stale or wrong index classification cannot leak. It inherits the
secure notes' at-rest protection (account isolation + FileVault) and is excluded
from every diagnostics path. Full record: egress threat model O7, design in
[`../design/tantivy-search.md`](../design/tantivy-search.md).

## The egress map (destination class → data → guard)

| Path | Destination | Data | Guard |
|---|---|---|---|
| `web_fetch` | arbitrary public web | model-chosen URL text | secret scan + `vetted_resolve` IP-pinned SSRF block + same-host redirects + 2 MB / 2048-char caps (fixtures) |
| `web_search` | selected literal provider: `lite.duckduckgo.com` / `html.duckduckgo.com`, or `api.search.brave.com` | query | per-chat globe consent + per-vault provider selection + `blocked_for_remote` secret/private-prose scan + 512-char cap + redirect/body/time caps; Brave credential is read from Keychain in Rust at request time |
| `chat_messages` | registered loopback model server | conversation transcript + images | `endpoint_permitted` accepts only registered on-device loopback destinations; direct Gemini/remote HTTP is unavailable |
| `generate_image` | none | model-authored prompt | native command returns the provider-image policy error before root/path resolution, credential lookup, or process spawn |
| CLI lanes (`claude` / `codex` / `cursor` / `antigravity`) | Anthropic/OpenAI/Cursor/Google through their official local clients or agents | transcript | native provider allowlist before binary lookup; binary+model allowlists (parity-pinned), safe/tool-less/read-only argv or ACP protocol fields, secret scan; Cursor runs ACP Ask mode from an empty scratch workspace with client capabilities off and permission requests rejected; Antigravity runs Google's registry-listed ACP agent from a managed install with the same client posture (no fs/terminal capability, permissions rejected, native questions cancelled, no-tools override) and its own Google sign-in |
| Antigravity runtime install (`antigravity.rs`) | literal `dl.google.com` archive URL from the ACP registry | nothing (a download) | pinned SHA-256 + byte size verified before extraction, byte-capped stream, Apple Silicon only, user-initiated from Settings; the agent then runs with a private profile, `GOOGLE_*`/`GEMINI_*` host variables stripped, `BROWSER` pinned to a no-op, and only Google's own loopback-redirect authorization URL may be opened |
| Resend (Rust `breve.rs` + breve-runtime send lanes) | literal `api.resend.com` | brief text | Keychain Bearer (allowlisted names), configured recipients, delivery-claim idempotency |
| signal-cli sends | configured recipients | brief text | delivery-claim contract |
| Breve local-model tier (`llm.ts`) | loopback only | memex/Signal/watcher text + prompts | managed config is normalized to a registered local model at every native boundary; legacy cloud-spawn helpers refuse before binary lookup |
| Breve safe-fetch | curated public hosts | watchlist/summarize URLs | `safe-fetch.ts` (https-only, SSRF block, same-host redirects, caps) |
| YouTube probes (`signal-daemon.ts`, `creator-alerts.ts`) | literal `youtube.com` | handle/channelId in the path/query only | host-pinned literal, `checkUrl`-gated |
| Updater | GitHub releases | — | minisign-signed feed, single pinned HTTPS endpoint |
| Private browser child webview | user-selected HTTP(S) destination through the chosen search provider | address/search text plus ordinary page traffic | explicit user navigation + `blocked_for_remote` address scan + scheme allowlist; only the provider ID persists; non-persistent datastore; remote guest omitted from every Tauri capability |
| ImapFlow (`mail.ts`) | configured mail hosts | — | TLS strict except loopback |
| Rotli app webviews | nothing | — | CSP `connect-src ipc:` only; no fetch/XHR/WebSocket in `src/` (`check:security` fails any undeclared raw `fetch(` under `src/`); capabilities target only `main`, `capture`, and `quick` labels rather than their whole windows |
| `rotli` CLI / `rotli-workspace` MCP | local Claude/Codex process | requested non-secure note text or compact board data | registered-root discovery + no-follow containment + remote-AI secure detector + locked-note refusal + optimistic revision check + request/output/schema caps + destructive annotations; stdio or authenticated loopback HTTP |
| Remote-agent connector | user-configured HTTPS relay (loopback HTTP in development) | token-bound MCP frames already filtered by `workspace.rs` | explicit per-launch connect + independent Keychain device/client credentials + no public Mac listener + exact role checks + no redirects + bounded request/response frames and sessions; vault switches fail closed unless the old connector stops |

The full inventory — every ureq / fetch / network-CLI call site with its
destination class and guard — is tracked in
[`../../scripts/fixtures/egress-allowlist.json`](../../scripts/fixtures/egress-allowlist.json).
Search endpoints are also parity-pinned in
[`../../scripts/fixtures/egress-fixtures.json`](../../scripts/fixtures/egress-fixtures.json).
The globe is internet consent for one chat; it does not choose a destination.
The selected provider is a vault setting, and a provider failure is returned as
that provider's failure. Rotli never retries through another provider because
that would silently change the egress destination. DuckDuckGo is the free,
unconfigured default and uses unofficial HTML pages whose availability may
vary. Brave is optional BYOK: Rotli sends the request directly from the Mac,
reads the key from the macOS Keychain only inside Rust, and never ships a shared
key or returns a saved value through IPC.

The workspace MCP server itself performs no network request, but a connected
Claude or Codex process may be remote. It therefore treats every agent as remote:
secure flags and secret-shaped bodies are omitted/refused even when a provider
CLI happens to run on localhost. Board metadata/scenes currently have no secure
classification; users must not place secrets on an agent-managed board.
Agent-visible workspace metrics are computed only after that same note filter and
do not disclose a count of withheld secure notes. `rotli agent doctor` forces a
read-only store, while `rotli agent self-test` uses only a temporary memex.
Every returned note/board value is labeled untrusted data: it cannot authorize a
tool call or count as mutation confirmation.

Local-model reasoning checkpoints are ephemeral loop scratch, not durable
memory: Rotli caps and budgets them, defuses them before prompt re-entry, and
does not emit them as UI events or save them in chat notes. Fetched webpage
results remain explicitly fenced as untrusted data. Carrying a checkpoint does
not widen egress permissions; every later web argument still passes the same
secret/private-prose guards immediately before dispatch.

Local source routing also never initiates egress. For an unmistakably public
fact question it may refuse to execute a weak model's mistaken note-search call
and return a local correction asking the model to choose `research_web`.
Personal anchors and attached notes win; ambiguous bare names remain
model-routed instead of being sent outward. The globe, selected destination,
secret scan, and private-prose overlap guard still apply after the model makes
that explicit web-tool call.

Markdown SVG fences are also untrusted content. The editor parses them as XML
and rebuilds a fresh, allowlisted SVG subtree; source nodes are never adopted
into the live document. Event attributes, scripts, `foreignObject`, external
resources, unsafe URL schemes, inline styles, and unexpected namespaces fail
closed. The production CSP is a second layer, not the sanitizer.

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
- **(b) Keychain literals.** The three allowlisted account names may appear only at
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
(`src-tauri/src/web.rs` / `src-tauri/src/web_search.rs` `#[cfg(test)]` +
`breve-runtime/tests/test-safe-fetch-fixtures.ts`
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
4. **`generate_image` provider privilege — RETIRED.** Provider-backed image
   generation is disabled at the native command boundary before path
   resolution, credential lookup, or process spawn. The former AGY launcher,
   Seatbelt profile, retry, and image implementation were removed.
5. **Non-secret private prose via web tool args — FIXED for substantial verbatim
   overlap.** Web/image arguments are compared with locally retrieved tool
   results before dispatch; a five-token, 24-character copied phrase is refused
   even when it is not secret-shaped. The web globe/image capability, URL and
   step caps, secure-note exclusion, and secret scan remain independent layers.
   Paraphrased semantic leakage is a residual risk for the quarterly review.

### Supply-chain advisories (tracked; reviewed 2026-09-05)

All are outside Rotli's own `src/`. The repository has three independent Bun
lockfiles, so `bun run deps audit` scans each one instead of treating the root
as the whole product. After compatible repair and dedupe, the current tool
reports 13 findings in the app graph (8 high, 5 moderate), 5 in the marketing
site (1 high, 4 moderate), and 1 high finding in Breve's production graph.
These totals overlap across lockfiles and are not 19 distinct advisories.

The 0.90.0 release pass also repaired compatible fflate 0.4.8 → 0.4.9
(archive extra-field bounds) and site fast-uri 3.1.5 → 3.1.6 (URI parsing).
Package diffs were reviewed: no new runtime dependencies, entry points, or
install hooks; the existing script-free frozen-install policy remains intact.

The reviewed Bun 1.4 maintenance pass repaired every version permitted by the
current dependency ranges. The app moved both `brace-expansion` lines,
DOMPurify, Immutable, `ip-address`, the compatible NanoID line, and tar; the
site moved JS-YAML, NanoID, and Sharp; Breve moved `ip-address` and tar. Dedupe
then converged all three graphs, including the site's Sharp line at 0.35.2, and
the follow-up `audit-plan` reports zero remaining compatible fixes. The
following findings require an upstream range or deliberately reviewed direct
dependency change:

- **lodash-es** ≤ 4.17.22 (two high/moderate families: template-key code
  injection and prototype pollution) — through Univer, Mermaid, and Excalidraw.
- **nanoid** locked 3.x, 4.x, and 5.x lines and **uuid** 8.3.2 (moderate/high) —
  library-internal ID generation through Excalidraw, Univer, Vite, exceljs, and
  Mermaid. The compatible NanoID 3.3.18 line is repaired; Excalidraw, Univer,
  the converter, and exceljs carry exact or major-bounded ranges.
- **sharp** < 0.35.0 (high libvips image-processing family) — through the optional
  Kokoro/Transformers local voice stack (`@huggingface/transformers` →
  `onnxruntime-node`); Sharp is also an exact direct app build dependency.
  Transformers blocks Sharp 0.35, while the site's independent Sharp graph is
  repaired.
- **undici** 7.28.0 (one high and four moderate request/cache parsing
  advisories) — through the site's pinned Wrangler/Miniflare toolchain. The
  current Miniflare alpha pins that exact version, so no compatible repair is
  available.

**Temporary release exception SC-2026-08-31 — accepted 2026-08-31; owner:
@SethMed7; expires 2026-09-30.** This exception covers only the exact blocked
paths above and does not turn the advisory audit green. The current
`audit-plan` reports zero compatible fixes. Lodash, NanoID, and UUID are
transitive implementation details of the named document/board libraries;
Rotli does not call their vulnerable template-import, caller-selected-size, or
caller-provided-buffer APIs. Sharp's shipped path is the optional local speech
stack, which does not decode user images; Rotli's direct Sharp calls are
development checks over repository-owned assets. Undici is confined to the
site deployment toolchain and is not bundled into Rotli.app. The remaining
impact is a compromised or unexpectedly unsafe upstream call path: code or
prototype manipulation, an ID-generation denial of service, a UUID buffer
write, local image-parser corruption, or site-tool HTTP parsing failure.
Compensating controls are frozen script-free lockfiles, adapter input/size
limits, the absence of direct app calls to the vulnerable APIs, and the
required full regression/build proof. Re-run `bun run deps audit-plan` before
every release candidate and at expiry; any newly compatible fix, upstream
range, direct reachability, or exploit evidence ends this exception and blocks
publication until repaired and reviewed. This exception does not auto-renew.

**2026-09-05 revalidation of SC-2026-08-31 (same owner and expiry):** after
the two compatible repairs above, `audit-plan` reports zero compatible fixes
across all three roots. The two additional app findings are the 3.x/4.x forms
of [NanoID integer overflow](https://github.com/advisories/GHSA-xwg4-73v4-xw9w).
It corrupts the Node RNG pool when a caller supplies an overflowing size,
potentially making later IDs predictable. The affected shipped paths remain
Excalidraw 0.18.1 → NanoID 3.3.3 and mermaid-to-excalidraw 2.2.2 → 4.0.2;
inspection of their installed call sites found default-size `nanoid()` calls,
not user-supplied sizes. Rotli has no direct NanoID calls. Thus the existing
no-caller-selected-size boundary still applies; it is not a general assurance
about downstream consumers or a renewal of the exception. Any future
caller-controlled size requires repair/review before release.

The site-only Undici path is a build/deploy input rather than app-bundle runtime
code, but it still executes in the release pipeline and remains supply-chain
relevant. Breve's sole remaining finding is the Transformers Sharp range in the
independently installed runtime graph.

**esbuild** left the tree entirely with the 2026-08-01 rolldown-vite migration
and stays out under Vite 8 (Vite keeps esbuild as an *optional* peer and Rotli
does not install it), so its low Windows dev-server advisory remains retired.

The direct `@excalidraw/mermaid-to-excalidraw` 2.2.2 dependency is the narrow
board-engine conversion seam. Excalidraw already supplied the same version
transitively, so this does not add another converter or widen the runtime's
network/egress surface.

The direct MIT-licensed `pdf-extract` 0.12.0 dependency is confined to
`src-tauri/src/document_conversion.rs` and parses local, untrusted PDFs without
network access. Rotli caps source and extracted sizes, catches parser panics,
rejects empty/scanned extraction, and never writes the original; malformed,
page-boundary, and end-to-end DOCX-package tests cover the adapter. Its locked
transitive path is `pdf-extract → lopdf` plus font/encoding and cipher helpers.
Review this parser boundary before upgrading or before broadening PDF support
beyond embedded text.

RustSec found two `quick-xml 0.39.4` denial-of-service advisories
(`RUSTSEC-2026-0194` and `RUSTSEC-2026-0195`) in the July 21 pushed run. They are
fixed in Rotli's lockfile by upgrading Tauri's compatible `plist` dependency to
1.10.0, which selects patched `quick-xml 0.41.0`. **anyhow 1.0.102** is likewise
fixed at 1.0.103. **glib 0.18.5** (`RUSTSEC-2024-0429`) exists only in Tauri
2.11's Linux GTK3 target graph (`tauri → tray-icon/webkit2gtk → gtk/glib`); it
is absent from the shipped macOS graph and has no compatible patched GTK3
release. The audit ignores that exact ID while retaining the dependency path
here; Tauri's eventual Linux GTK4 move is the removal path. RustSec also reports
18 allowed warnings: ten GTK3 crates plus `proc-macro-error` through the
Linux-only `tauri → gtk/glib` graph; five UNIC crates through
`tauri-utils → urlpattern`; and `ttf-parser 0.25.1` (`RUSTSEC-2026-0192`)
through the shipped `pdf-extract → lopdf` parser boundary described above.
The remaining warning is `lru 0.16.4` (`RUSTSEC-2026-0253`) through current
`tantivy 0.26.1`. The unsound `pop()` path requires a key whose `Drop` panics;
Tantivy's only LRU is `LruCache<usize, Block>`, so Rotli cannot supply such a
key, and the latest Tantivy release does not yet admit patched `lru 0.18.2`.
These warnings are maintenance/reachability notices rather than scanner-reported
reachable vulnerabilities. The GTK3 items leave with Tauri's Linux GTK4 move;
the other paths stay under compatible lockfile review and the PDF/search
adapters' existing size and failure controls.

The `dependency-audit` CI job is deliberately advisory. `continue-on-error` is
set only on the two scans; installing the pinned `cargo-audit` binary remains a
blocking prerequisite. Results stay in the ordinary job log, so the workflow
token remains read-only and no separate check-report permission is needed.
Promote the scans to blocking after upstream updates clear the tracked tree.

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
