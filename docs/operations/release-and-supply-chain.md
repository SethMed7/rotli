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

- runs the JavaScript/TypeScript proof chain;
- requires a successful hosted `Regression suite` conclusion for the exact
  source commit before publication;
- clears stale DMG volumes and any `node_modules` under `breve-runtime/`, then
  refuses to notarize a built `.app` that still contains one;
- builds a Developer ID-signed app with hardened runtime;
- notarizes and staples the app;
- regenerates and signs the updater archive from the stapled app;
- creates, signs, notarizes, and staples the DMG;
- creates `latest.json`; and
- records the exact source, CI run, repository-pinned toolchains, and artifact
  SHA-256 digests in `release-evidence.json`; and
- publishes only when `--publish` is passed.

Known hardening gaps before a 1.0 or paid production release:

- add an SBOM, signed artifact/source provenance, retained notary submission
  records, and an off-GitHub evidence archive;
- define beta/stable channels and a signed rollback procedure;
- record and review the Apple notary log, not only the success status; and
- move signing/updater key custody from single-maintainer knowledge to a
  documented recovery and rotation process.

This list is explicit so a green beta workflow is never misrepresented as full
supply-chain assurance.

## Release evidence bundle

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
    "result": "success or explicitly overridden conclusion"
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
outage cannot erase the provenance record. That archive, an SBOM, signed
provenance, and retained notary identifiers remain promotion requirements
rather than fields that imply evidence the current script does not yet collect.

## Dependency policy

- Lockfiles are frozen in CI and changed only in reviewed commits.
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
- Treat dependency install scripts and trusted native packages as executable
  supply-chain inputs.
- Review changes to lockfiles, workflows, release scripts, entitlements, CSP,
  Tauri capabilities, and updater endpoints as security-sensitive.

## Key custody and recovery

The repository contains public identifiers and updater verification material,
never private signing keys or notarization credentials.

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

- protect the release branch with required reviews and checks;
- eliminate dirty-tree publication and silent tag failures;
- extend the generated evidence with an SBOM, signed provenance, retained
  notary records, and a maintainer-controlled archive;
- complete a signing-key loss/rotation tabletop;
- complete one updater rollback/superseding-release exercise; and
- demonstrate install, update, and offline Gatekeeper behavior on a clean Mac.
