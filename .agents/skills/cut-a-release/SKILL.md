---
name: cut-a-release
description: Cut a signed, notarized Rotli release — version bump, changelog, promotion to main, exact-commit CI, release.sh, and post-release checks. Use only when the owner has explicitly asked for a release.
---

# Cut a release

`docs/operations/release-and-supply-chain.md` owns the release contract and
`scripts/release.sh` owns the mechanics. A release needs the owner's explicit
instruction; a merge never authorizes signing, notarization, or publication.

1. **Version everywhere, once.** Bump `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and the `rotli` entry in `src-tauri/Cargo.lock`. Close
   `## [Unreleased]` in `CHANGELOG.md` into a dated section. A major version
   bump needs `--launch`; the script refuses it otherwise.
2. **Land it.** Release PR into `dev` (see `ship-a-change`), then the
   `dev` → `main` promotion PR as a merge commit.
3. **Wait for CI on `main`'s exact commit.** The script checks that conclusion
   itself and stops on anything but success.
4. **Run the release** from a clean checkout of that commit. `APPLE_SIGNING_IDENTITY`
   must hold the Developer ID Application identity from the local keychain
   (derive it from `security find-identity -v -p codesigning`); never print it
   into logs, docs, or PRs.

   ```sh
   bash scripts/release.sh --authorize=<full main sha> --publish
   ```

   Do not pipe the script into `tail` or `head`; that hides a failed exit code.
5. **Check the publication.** The release exists on `SethMed7/rotli-releases`,
   and `releases/latest/download/latest.json` reports the new version. Report
   what shipped, the commit, and the tag.

The marketing site deploys separately on Railway; changing its mode or content
is its own owner decision.
