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
3. On-device model access to a secure note is denied unless that note explicitly
   allows it. The organizer never receives that permission.
4. Every filesystem mutation stays inside a registered root and a declared
   write lane after Rust independently validates the path and operation.
5. Credentials remain in the macOS Keychain and never enter note files, settings,
   process arguments, logs, or model prompts.
6. Untrusted content is treated as data. It cannot grant itself tools, widen an
   endpoint, choose an arbitrary local path, or turn a failed security check into
   an allow decision.
7. Release updates are accepted only through the pinned, signed updater path.
8. A failure to parse security state fails closed; a failure to parse rebuildable
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
| Prompt injection asks a model to reveal notes or run code | Tool allowlists, prompt framing, bounded loops, secure-note exclusion, sandboxed CLI argv | Novel indirect exfiltration through permitted web arguments; security review |
| Secret-shaped text reaches a remote destination | Independent TypeScript/Rust detection, final-prompt scan, endpoint locality gate | Images are consented attachments and not OCR-scanned; documented accepted gap |
| Secure content appears in search, metrics, or an agent response | Filter before mapping/search/read; fail-closed metadata parsing; remote policy for every agent | Board scenes have no secure classification; users must not store secrets in agent-managed boards |
| A crafted path escapes the corpus or writes a forbidden file | Canonical registered-root resolution, path/extension checks, declared Rust write lanes, atomic operations | A fully compromised Rust host is out of scope |
| A fetched URL reaches loopback, metadata services, or private networks | Scheme/host limits, vetted DNS resolution, IP pinning, same-host redirects, response caps | Breve owner-configured fetch retains a documented DNS-rebinding residual |
| A malicious document package exploits a codec or exhausts resources | Vendor code behind adapters, package preservation tests, size/shape validation where implemented, dependency audit | Complex third-party parsers retain supply-chain and parser risk |
| A compromised webview invokes privileged IPC | Strict CSP, narrow Tauri capability grants, typed facade, Rust revalidation | Webview compromise may exercise any intentionally exposed command as the user |
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
