# Release and software-supply-chain contract

This document defines what must be true of a Rotli release artifact and the
evidence retained after publication. [`../../scripts/release.sh`](../../scripts/release.sh)
is the current implementation; this contract is the target it must continue to
approach without weakening local-first product boundaries.

## Release invariants

A production release is attributable, repeatable enough to investigate, and
recoverable:

1. The source worktree is clean and `HEAD` is the exact reviewed commit being
   released.
2. The exact commit passed the required TypeScript/Bun, Rust, Breve, browser E2E,
   architecture, security, and production-build gates.
3. App, Cargo, package, changelog, updater, release title, source tag, and
   artifact versions agree.
4. The macOS app and DMG are Developer ID signed, notarized, and stapled. The
   updater archive is generated from the final stapled app and signed with the
   pinned updater key.
5. Published artifacts carry cryptographic checksums, a dependency/SBOM
   inventory, the source commit, and the relevant signing/notary evidence.
6. Publishing is all-or-nothing from the operator's perspective. A failed tag,
   upload, or manifest step is visible and recoverable; errors are not silently
   ignored.
7. A rollback or superseding release can be issued without weakening signature
   verification or overwriting historical evidence.
8. **The bundle contains only what the repository declares.** A release must not
   vary with the state of the machine that built it. `tauri.conf.json` copies
   `breve-runtime/` wholesale into `Resources`, and Breve resolves its own
   production dependencies inside that folder at runtime, so a machine that has
   run a routine grows a gitignored `node_modules` that a naive build would
   ship. `scripts/predmg-clean.sh` removes such trees before the build and
   `scripts/release.sh` fails closed on the built `.app` if any survive.

Releasing, installing, or changing a delivery channel remains an explicitly
authorized operation. Passing local checks does not authorize publication.

## Current beta flow

The current script:

- requires the owner's explicit `--authorize=<full-sha>` acknowledgement, an
  authenticated @SethMed7 operator, exact promoted `origin/main`, and successful
  hosted main/push CI **before** signing or any Apple upload; red CI cannot be
  overridden;
- forces `ROTLI_BUILD_CHANNEL=stable` for both frontend and native build;
- requires the private `APPLE_SIGNING_IDENTITY` environment variable at release
  time; the public repository contains no certificate owner or Apple team id;
- runs the JavaScript/TypeScript proof chain;
- requires a successful hosted `Regression suite` conclusion for the exact
  source commit before publication;
- clears stale DMG volumes and any `node_modules` under `breve-runtime/`, then
  refuses to notarize a built `.app` that still contains one;
- builds a Developer ID-signed app with hardened runtime;
- notarizes and staples the app, validates its ticket, and requires Accepted
  submission and log status without unresolved Apple issues;
- regenerates and signs the updater archive from the stapled app;
- creates, signs, notarizes, and staples the DMG; Gatekeeper assessment of
  both app and DMG is blocking. The release also carries the same bytes as
  `Rotli.dmg`, so `releases/latest/download/Rotli.dmg` (the site's and README's
  Download link) always downloads the newest build directly;
- creates `latest.json`; and
- records the exact source, CI run, repository-pinned toolchains, and artifact
  SHA-256 digests in `release-evidence.json`; and
- retains raw submission/log JSON privately under ignored
  `_review/release-notary/<source-commit>/`, publishes only `{id,status}` per
  artifact in hashed `notary-evidence.json`, and unsets updater key environment
  variables after signing; and
- publishes only when separately authorized and `--publish` is passed.

The SHA flag records operator intent; a flag or GitHub login cannot prove the
human requested a release. Agents still require an explicit target-specific
owner instruction before running signing/notarization, and a separate publication
instruction before `--publish`. Ordinary launch preparation does not authorize
either. Unknown flags fail closed.

Known hardening gaps before a 1.0 or paid production release:

- add an SBOM, signed artifact/source provenance, and an off-GitHub evidence archive;
- define beta/stable channels and a signed rollback procedure;
- exercise the revised notary/Gatekeeper flow on the exact owner-authorized candidate; and
- move signing/updater key custody from single-maintainer knowledge to a
  documented recovery and rotation process.

This list is explicit so a green beta workflow is never misrepresented as full
supply-chain assurance.

## Release evidence bundle

Before an Apple upload, `security:bundle` examines the actual built `.app`,
including ignored files copied into resources and binary strings. It refuses
environment/credential files, embedded personal home paths, and links escaping
the app. Bundled Breve resources must also appear in the clean source manifest,
so an arbitrarily named ignored personal note is refused. A changed Tauri
resource mapping requires updating this gate. Diagnostics show relative paths
and reasons, never file contents.
The release compiler flags remap the operator's home and checkout paths into
generic build paths while preserving existing Cargo flags. This does not hide
the Developer ID certificate's public signer identity. Synthetic boundary tests
pass; the exact signed candidate still needs this inspection and native acceptance.

`release.sh --publish` generates and uploads this machine-readable core
manifest from the reviewed repository pins:

```json
{
  "schemaVersion": 1,
  "product": "rotli",
  "version": "0.x.y",
  "sourceCommit": "full git sha",
  "sourceTag": "v0.x.y",
  "builtAt": "ISO-8601 UTC",
  "toolchain": {
    "bun": "exact",
    "rust": "exact",
    "macos": "runner/build host"
  },
  "checks": {
    "ciRun": "immutable URL or identifier",
    "result": "success"
  },
  "artifacts": [
    {
      "name": "artifact filename",
      "sha256": "digest",
      "signature": "signature filename"
    }
  ]
}
```

The manifest contains no credential, local path, Keychain name beyond public
configuration, or user data. The current script stores it with the GitHub
release. A maintainer-controlled archive must be added so a delivery-repository
outage cannot erase the provenance record. That archive, an SBOM, and signed
provenance remain promotion requirements
rather than fields that imply evidence the current script does not yet collect.

## Dependency policy

- Lockfiles are frozen in CI and changed only in reviewed commits.
- The app, marketing site, and Breve runtime are independent Bun install roots.
  Each manifest names the repository's exact `.bun-version`, each root holds the
  same three-day `install.minimumReleaseAge`, uses lockfile v2, defaults even a
  plain install to `install.frozenLockfile`, and installs without package
  lifecycle scripts through the isolated linker and a project-local store. An
  older Bun that cannot read v2 therefore fails without replacing the reviewed
  graph. `bun run deps audit` scans all three lockfiles. The age gate affects
  new resolution only; frozen installs do not reinterpret an existing lockfile.
- Protected CI blocks on cross-lockfile convergence and exact drift from
  `scripts/dependency-license-baseline.json`, then retains the combined
  production dependency-license inventory for 30 days. A newly Unknown package
  requires review, while an entry that gains recognized metadata makes the
  stale baseline fail until it is removed. The inventory does not claim to be
  the complete Rust/assets/package SBOM.
- New dependencies justify the capability, license, maintenance health,
  transitive cost, parser/network risk, and adapter boundary.
- Runtime dependencies that parse untrusted content receive focused malformed,
  oversized, and preservation fixtures.
- Vulnerability audits run on every protected change and release candidate.
- A reachable critical vulnerability blocks release.
- High or moderate findings require either a fix or a dated exception recording
  dependency path, shipped-platform reachability, impact, compensating controls,
  owner, and expiration.
- An expired exception blocks release even when the scanner remains advisory.
- Build-only or unshipped-platform findings may be accepted only with their
  exact dependency path and reason.

The repository-owned `bun run deps` workflow separates observation from
mutation:

| Action | Contract |
|---|---|
| `audit` | Read-only scan of all three lockfiles; available on the stable Bun pin and advisory in CI while dated exceptions remain |
| `audit-plan` | Bun 1.4+ `bun audit fix --dry-run --json`; emits one combined document and never installs. A maintainer reviews the proposed versions and blocked paths before any mutation |
| `dedupe-check` | Bun 1.4+ read-only lockfile convergence check. Candidates fail the command so they cannot be mistaken for a clean graph; applying `bun dedupe` is a separate reviewed change because a compatible older locked version may win |
| `prune-plan` | Bun 1.4+ local stale-install preview. It never replaces the pre-DMG removal of Breve's whole generated `node_modules` resource tree |
| `licenses` | Bun 1.4+ production-dependency license inventory for every install root. It supplements rather than claims to be the Rust/assets/package SBOM |
| `licenses-check` | Bun 1.4+ exact ratchet over the production inventory's Unknown group. It rejects unreviewed additions and stale reviewed entries across all three roots |
| `diff` | Bun 1.4+ root-explicit package-source comparison. Review high-risk runtime, parser, native, network, lifecycle-script, binary, and entry-point changes before accepting a lockfile update |

Mutating maintenance is maintainer-operated only and requires exactly one root
plus an explicit acknowledgement: `audit-fix --root=<id> --apply`,
`dedupe --root=<id> --apply`, or `prune --root=<id> --apply`. Start with the
matching read-only plan. `audit-fix` suppresses lifecycle scripts and never
implies `--latest`; do not use a cross-range upgrade as an automatic escape from
a blocked advisory. After an approved repair, re-run the audit, inspect the
manifest and lockfile, use `diff` for affected high-risk packages, then run the
complete Rotli proof chain. Security fixes may intentionally bypass the
release-age window; the plan must call that out for review.

Bun 1.4.0 is the release runtime. `.bun-version`, all three `packageManager`
fields, CI, release evidence, and the local release check move together on that
exact stable pin. `ROTLI_BUN_DEPENDENCY_BIN` remains available for isolated
evaluation of a compatible alternate binary, but a moving canary never becomes
release evidence.

The current advisory inventory and Rust target-graph exception live in
[`../development/security.md`](../development/security.md). Do not duplicate
version-specific findings here.

## Action and toolchain integrity

- Pin CI runtimes to deliberate versions.
- Pin third-party GitHub Actions by full commit SHA and retain the human-readable
  release tag in a comment.
- Minimize workflow token permissions per job.
- Do not run untrusted pull-request code with release secrets.
- Separate regression credentials from signing/publishing credentials.
- Keep dependency lifecycle scripts disabled. Native or generated packages
  must pass the repository smoke without a trusted-script exception; any future
  exception is an executable supply-chain change and requires explicit review.
- Review changes to lockfiles, workflows, release scripts, entitlements, CSP,
  Tauri capabilities, and updater endpoints as security-sensitive.

## Key custody and recovery

The repository contains public identifiers and updater verification material,
never private signing keys or notarization credentials. Developer ID signatures
contain the publisher identity and certificate chain: moving the signing identity
out of source does **not** make a signed binary anonymous. Before distribution,
the owner must accept the certificate's public identity or arrange an appropriate
organization identity with Apple. Do not print that identity into public CI logs.
Apple notarization uploads the app/archive to Apple; it must contain only reviewed
build inputs, never user notes or machine-local state. See
[Apple's custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

For every release credential, maintain outside the repository:

- owner and backup owner;
- storage mechanism and access-review cadence;
- creation and last-rotation date;
- recovery procedure;
- revocation procedure;
- affected artifacts and clients; and
- the emergency communication path.

Key rotation must support an overlap or signed transition where the client
protocol permits it. A suspected compromise stops publication until the impact,
revocation, replacement, and already-shipped client behavior are understood.

## Channels, rollback, and emergency releases

- **Beta** receives pre-1.0 and explicitly previewed builds.
- **Stable** exists only after its promotion criteria and compatibility promise
  are documented.
- A channel manifest is signed and cannot redirect to an unsigned artifact.
- Rollback normally means a new signed superseding release. Serving an older
  binary requires proof that its persistent formats remain downgrade-safe.
- Emergency security releases may shorten review time but do not skip clean
  source, signature, provenance, or minimum regression evidence.
- A revoked release stays listed in the historical record with the reason and
  safe replacement; it is not silently deleted.

## Promotion criteria

Before calling the delivery process production-ready:

- enforce both main/dev rulesets from [repository access](repository-access.md);
- eliminate dirty-tree publication and silent tag failures;
- extend the generated evidence with an SBOM, signed provenance, retained
  reviewed notary records, and a maintainer-controlled archive;
- complete a signing-key loss/rotation tabletop;
- complete one updater rollback/superseding-release exercise; and
- demonstrate install, update, and offline Gatekeeper behavior on a clean Mac.
