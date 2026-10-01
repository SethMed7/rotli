# Pinned sites: up to three signed-in pages beside the title bar

**Date:** 2026-10-01 · **Status:** accepted; Mac app on macOS 14 or later

## Context

The owner, 2026-10-01: "allow for up to 3 bookmarks of places you log in to,
and they stay logged in … they don't open up as a tab, so the tab isn't always
in the way; they can go up here [the title bar], to the left of the browser."
The first idea was a button that opens their X account in a private browser.

Every browser page Rotli shows today is private: a child WKWebView on WebKit's
non-persistent data store, forgotten when it closes
(`src-tauri/src/private_browser.rs`). Staying signed in needs the opposite: a
store that persists. That changes a promise three security documents make, so
it is decided here first.

## Decision

1. **Up to three pinned sites**, each a name and an `https` address, kept in
   the app settings on this Mac (`pinnedSites`) with a random 16-byte store id.
   No cookie, token, or page content is ever in a Rotli file.
2. **One persistent WebKit store per site** (`data_store_identifier`, wry →
   `WKWebsiteDataStore dataStoreForIdentifier:`). A pin's cookies never reach
   another pin, Rotli's own webview, or a private tab, which all keep their
   current stores. WebKit offers per-identifier stores on **macOS 14 and
   later** only; below that it would silently fall back to the store Rotli's
   own webview uses, so Rust refuses to open a pin there
   (`pinned_sites_supported`) and the feature doesn't show.
3. **The same guest as the private browser, minus forgetting.** A child webview
   of the main window labelled `pinned-site-<slot>-<store>`, in no Tauri
   capability (so the page can't reach Rotli's IPC), `blocked_for_remote` on the
   address, https-only navigation (stricter than the private browser: a
   signed-in session never rides plain http), downloads refused. The label
   carries the store, so a page only ever shows the pin it was built for: a new
   pin in a freed slot never reuses an older pin's live page. A page that asks for a
   new window is navigated in place instead (redirect-style sign-in keeps
   working; it stays inside the pin).
4. **A panel, not a tab.** A pin's button sits left of the globe; it opens the
   site in a panel under the title bar. Dismissing hides the page and keeps it
   alive for a quick return; a page hidden for ten minutes is closed (WKWebView
   doesn't throttle a hidden page, CARL ROTLI_CORE#10); showing it again first
   cancels that. ⌘K, Settings, and menus put the page away as they open (on the
   store change, before they paint), because a native webview draws over
   Rotli's own UI.
5. **Removing a pin signs it out.** It closes the page, then deletes its store
   (`remove_data_store`), and only then frees the slot; if either step fails
   the pin stays, so removing can be tried again. A pin's address is changed
   by removing it and pinning the new one. A pin saved on this Mac can always
   be removed; new pins are offered only once the Mac has said it supports
   them.

## Consequences

- The person's session for that site lives in WebKit's storage under
  `~/Library/WebKit/` for this app, like Safari's: anyone using this macOS
  account can use the signed-in site. Rotli never reads it.
- Sites that sign in through a popup that talks back to its opener may not
  work in the panel; the person can still sign in through the site's own
  redirect flow, or keep using a private tab.
- `docs/security/threat-model.md`, `docs/development/security.md`, and
  `docs/architecture/egress-threat-model.md` carry the new surface.
