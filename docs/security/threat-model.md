# Rotli threat model

This is the canonical threat model for the Rotli product and development
system. [`../development/security.md`](../development/security.md) owns the
executable egress inventory and security checks; this document owns assets,
actors, trust boundaries, abuse cases, security properties, and residual risk.

The model describes the current local-first desktop product. It does not assume
an account service, cloud note store, product telemetry, or multi-user tenancy.
Adding any of those is a material boundary change and requires a new review
before implementation.

## Security properties

Rotli must preserve these properties even when imported content, a remote model,
or a compromised dependency behaves adversarially:

1. User files remain readable without Rotli and are never replaced by an
   application database.
2. Secure or secret-shaped Markdown never reaches a remote model, web tool, or
   external workspace agent through a Rotli-controlled send path.
3. On-device model access to a secure note is permitted by default and can be
   withdrawn per note or per vault; it is the LOCAL tier that is allowed, never
   a remote one. The organizer never receives that permission.
4. No AI of any class edits a note marked `locked`. Locking withholds edit
   authority, not visibility — every class may still read it.
5. Every filesystem mutation stays inside a registered root and a declared
   write lane after Rust independently validates the path and operation.
6. Credentials remain in the macOS Keychain and never enter note files, settings,
   process arguments, logs, or model prompts.
7. Untrusted content is treated as data. It cannot grant itself tools, widen an
   endpoint, choose an arbitrary local path, or turn a failed security check into
   an allow decision.
8. Release updates are accepted only through the pinned, signed updater path.
9. A failure to parse security state fails closed; a failure to parse rebuildable
   presentation state falls back to a safe default without damaging content.

## Assets and data classes

| Class | Examples | Required handling |
|---|---|---|
| User content | Markdown prose, boards, documents, sheets, attachments, chat history | Local durable truth; no implicit upload; preserve unknown data |
| Protected content | Secure notes, secret-shaped chat history, locally permitted secure context | Omit from remote maps/search; deny remote reads and sends |
| Credentials | Provider keys, Resend token, CLI login material, signing/notary credentials | Keychain or external release secret store; never repository or logs |
| Control state | `memex.json`, `corpus.json`, permissions, provider settings, updater key | Validate independently; version or fail closed where writes are possible |
| Rebuildable state | Indexes, view state, open-request mailbox, generated caches | Deletable; corrupt input falls back without changing content |
| Recovery evidence | Main arrangement, organizer journal, backups, delivery claims | Atomic writes; preserve enough provenance for restore or safe retry |
| Operational evidence | CI reports, dependency findings, release manifests, diagnostics | Content-free by default; bounded retention; access limited to maintainers |

`secure` is an AI-egress and organizer-access classification, not at-rest
encryption. Secure notes remain plain files in a protected filesystem lane.
Rotli relies on macOS account isolation and, when enabled by the user or an
administrator, FileVault for storage encryption. Do not describe secure notes
as an encrypted vault.

## Actors and assumptions

- **The local user** is authorized to read and edit the files their macOS account
  can access. Explicit user actions may enable remote providers or external
  delivery.
- **The macOS host** and the current user session are trusted in the present
  product model. A hostile process running as the same user can already read
  ordinary Markdown directly; the Rotli CLI does not claim to sandbox peer local
  processes from those files.
- **The webview** is less trusted than the Rust host. It sends intent through
  typed IPC; Rust revalidates paths, permissions, write lanes, and security
  state.
- **The private-browser guest** is fully untrusted remote content. It runs in a
  separate non-persistent child webview and matches no Tauri capability; only
  the app-owned `main`, `capture`, and `quick` labels receive IPC permissions.
- **Imported content** is untrusted, including Markdown, DOCX packages, sheets,
  Excalidraw scenes, PDFs, fetched web pages, email, and chat memory.
- **Local models** are untrusted interpreters running on loopback. Locality
  changes the permitted data class, not the model's authority.
- **Remote models and subscription CLIs** are off-machine recipients. Endpoint
  identity and model capability are verified independently of their display
  names.
- **Workspace agents** are treated as remote for content policy even when their
  stdio process runs locally.
- **Network services** and DNS responses are untrusted. Each destination class
  is pinned, resolved, bounded, or explicitly approved at its adapter.
- **Dependencies and release infrastructure** may be compromised. Lockfiles,
  adapter seams, audits, signatures, notarization, and provenance reduce but do
  not eliminate this risk.

## Trust-boundary map

```text
untrusted files/content
        │
        ▼
format + corpus adapters ──► application policy ──► presentation
        │                         │
        │ Rust path/write gate    ├──► local model adapter
        │                         ├──► remote provider adapter ──► network
        │                         ├──► web adapter ──────────────► network
        │                         ├──► private browser guest ───► network
        │                         └──► workspace CLI/MCP ────────► agent process
        ▼
registered local roots

Keychain ── named credential adapters only
Updater  ── pinned HTTPS feed + signed artifact + notarized bundle
```

Dependencies point inward; no presentation or imported document may choose a
transport, credential, or filesystem authority directly.

## Abuse cases and controls

| Abuse case | Primary controls | Residual risk / owner |
|---|---|---|
| Prompt injection asks a model to reveal notes or run code | Structured untrusted model map, fenced/defused tool results, tool allowlists, explicit network capabilities, secret + private-prose overlap egress checks, bounded loops, secure-note exclusion, sandboxed CLI argv | Paraphrased semantic leakage through permitted web arguments; security review |
| Secret-shaped text reaches a remote destination | Independent TypeScript/Rust detection, final-prompt scan, endpoint locality gate | Images are consented attachments and not OCR-scanned; documented accepted gap |
| Secure content appears in search, metrics, or an agent response | Filter before mapping/search/read; fail-closed metadata parsing; remote policy for every agent | Board scenes have no secure classification; users must not store secrets in agent-managed boards |
| An AI edits a note the user locked | Locked refusal at every AI write path on both layers (`corpus_write_ai`, the host's `update_note`, chat-memory sync, workspace agents, the organizer) | A locked note is still readable by every model; locking is not confidentiality |
| A local chat launders secure prose into a note a remote chat later reads | One-way `secureContext` chat taint; tainted `create_note` is stamped secure; tainted `update_note` may edit only secure notes; a tainted loose chat writes no memory note; remote egress refuses tainted transcripts | A user who manually copies secure text into an open note is out of scope |
| A crafted path or writable-lane symlink escapes the corpus | Per-component no-follow metadata, canonical registered-root containment, path/extension checks, declared Rust write lanes, contained atomic-temp parents | Same-user replacement races and a fully compromised Rust host are out of scope |
| A compromised webview uses the vault chooser to enumerate or authorize arbitrary local paths | Rust-owned session rooted at canonical Home; direct-child component validation; directory names only; hidden names, files, symlinks, and Home ancestors excluded; final native authorization and privileged-root refusal | The explicit native **More locations…** fallback exposes the ordinary macOS picker to the local user; downstream Rust commands still revalidate the selected root |
| A fetched URL reaches loopback, metadata services, or private networks | Scheme/host limits, vetted DNS resolution, IP pinning, same-host redirects, response caps | Breve owner-configured fetch retains a documented DNS-rebinding residual |
| A search failure silently sends the query to another provider | The globe grants per-chat internet consent; a separate per-vault provider setting selects one literal Rust adapter; failures are typed observations and never cross-provider retries | DuckDuckGo's unofficial HTML surface may change or challenge clients; the user must explicitly choose another destination |
| A provider credential leaks into notes, settings, frontend state, or logs | Allowlisted macOS Keychain account; Rust-only read at request time; webview commands expose store/probe/delete but never read; sensitive-log tripwire; auth header never query string | A compromised same-user process can access that user's Keychain subject to macOS policy |
| A malicious document/board exploits a codec or exhausts resources | Vendor code behind adapters, package preservation tests, PDF source/extracted-text caps and panic refusal, parity-pinned Excalidraw byte/element/action/string/coordinate/depth limits, dependency audit | Complex third-party parsers retain supply-chain and decompression/resource-exhaustion risk |
| Active content in a Markdown SVG fence reaches the webview | Parse as XML, rebuild only allowlisted SVG elements/attributes, reject event attributes, scripts, `foreignObject`, external resources, unsafe URLs, styles, and foreign namespaces; production CSP remains defense-in-depth | Browser SVG implementations still require dependency/browser regression review |
| A compromised webview invokes privileged IPC | Strict CSP, narrow Tauri capability grants, typed facade, Rust revalidation | Webview compromise may exercise any intentionally exposed command as the user |
| A page in the private browser invokes Rotli IPC or retains a session | Separate child webview; capability targets name only app-owned webviews; no remote capability URLs; non-persistent WebKit data store; HTTP(S)-only top-level navigation; browser tabs hydrate as absent | The viewed site still receives ordinary browser request metadata and user-entered data; downloads are intentionally disabled in this first slice |
| A hostile same-user process invokes the workspace CLI | Registered roots, secure/locked refusal, revisions, remote content gate | Same-user processes can edit ordinary files directly; stronger OS isolation is not claimed |
| Two writers overwrite one another | Atomic writes, file locks where ownership matters, optimistic revisions for workspace edits | Editor/filesystem races outside revision-aware paths require focused tests |
| An updater or release channel is replaced | Pinned feed, minisign verification, Developer ID signing, notarization, stapling | Signing-key custody and release provenance remain operational responsibilities |
| Logs or diagnostics disclose content | No product telemetry/crash reporter; sensitive-log checker; manual redaction rules | Heuristic logging check is not proof; future support bundles require an explicit allowlist |
| A vulnerable dependency ships | Frozen lockfiles, advisory audits, adapter containment, documented dependency paths | Current transitive advisories remain accepted until upgraded or a release policy blocks them |

## Out of scope, explicitly

- A fully compromised operating system, Rust host, kernel, or administrator
  account.
- Confidentiality between processes running as the same macOS user when the
  underlying files are ordinary user-readable Markdown.
- Recovery of files the user or an external tool permanently deletes outside
  Rotli's archive/trash workflows.
- Provider-side retention or model training after the user explicitly enables a
  remote provider; provider terms remain outside Rotli's enforcement boundary.
- Encryption of the memex file format. Adding it would conflict with ordinary
  editor interoperability and requires a separate product decision.

An out-of-scope item must not be used to dismiss a cheap, well-bounded defense.
When a control can close part of the gap without changing the product model, add
it and document what remains.

## Risk acceptance

A known security gap may remain only when its record names:

- the affected asset and abuse case;
- reachability in the shipped macOS product;
- severity and likely impact;
- existing compensating controls;
- a maintainer owner;
- the review or expiration date; and
- the event that forces earlier reconsideration.

Dependency exceptions live beside the dependency paths in
[`../development/security.md`](../development/security.md). Architectural risk
decisions use [`../decisions/README.md`](../decisions/README.md). An expired
exception is a release finding, not permanent documentation.

## Review triggers and evidence

Review this model before a release that adds any of the following:

- a network destination, credential, provider, tool, or external delivery path;
- an account, telemetry, crash reporting, diagnostic upload, or synchronization;
- a new writable file surface or broader Tauri capability;
- a security classification or permission state;
- a new persistent or public protocol version;
- a signing, notarization, updater, or release-channel change; or
- a dependency that parses untrusted content or executes code.

Required evidence is proportional to the boundary: focused failure tests,
adversarial fixtures, independent Rust validation, updated egress inventory,
dependency review, and the complete proof chain in
[`../development/testing.md`](../development/testing.md).
