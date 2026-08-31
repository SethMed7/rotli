# Rotli privacy

Rotli is local-first. The selected notes folder is the source of truth, and the
current product has no Rotli account service, product analytics, advertising,
or automatic crash-reporting upload.

## Data stored locally

Rotli reads and writes user-selected Markdown, boards, documents, sheets, media,
chat history, and attachments. Rebuildable projections and explicit settings
live under `.rotli/` or the application configuration directory. Credentials
use the macOS Keychain rather than note files or settings.

Main is a reference arrangement over the same files, not a second content
store. Deleting the app does not transfer ownership of the files to Rotli.

## Network activity

Rotli does not operate an analytics or account endpoint. Network activity is
limited to declared product capabilities:

- the signed updater may check the pinned GitHub release feed;
- user-enabled remote model lanes send the bounded conversation/context needed
  for that request to the selected provider;
- web search/fetch sends the query or URL needed for the explicit web action;
- user-configured Breve email, Signal, mail, and watch services contact their
  configured destinations; and
- connected Claude, Codex, or other subscription CLIs follow the privacy terms
  of those tools and providers; and
- when the user explicitly connects Remote agents for the current app session,
  Rotli sends authenticated MCP request/response frames through the configured
  HTTPS relay. The relay keeps only in-flight frames in memory and stores no
  vault or Markdown; the cloud MCP client receives the non-secure workspace
  data requested through approved tools.

The destination inventory and guards are documented in
[`docs/development/security.md`](docs/development/security.md). Adding telemetry,
an account service, crash upload, sync, or another destination requires an
explicit privacy and threat-model change before implementation.

## Secure notes and locked notes

Secure notes are excluded from remote models, remote search observations, and
the organizer. Recognized on-device models — which cannot make a network call —
read them by default; that can be turned off for one note from its menu or for
the whole vault in Settings → Security. Nothing turns it on for a remote model.

Locked notes are a separate control: no AI of any kind may edit a locked note,
cloud or on-device. Locking withholds editing, not reading.

Secure notes are plain local files in a protected lane, not an encrypted vault.
Filesystem encryption is provided by macOS/FileVault when enabled. Users should
not put secrets on an agent-managed Excalidraw board because board scenes do not
currently have a secure classification.

## Workspace agents and diagnostics

The local CLI/MCP server uses stdio by default. Its optional HTTP mode is
token-authenticated and loopback-only. The Remote agents control is off after
every launch and opens an outbound relay connection only after the user clicks
Connect this session; it never exposes a public port on the Mac. It treats
agents as remote for content policy, omits secure/secret-shaped notes, refuses
locked writes, and requires optimistic revisions. The agent process or its model
provider may still be remote and has its own data practices.

Remote pairing stores independent device and client credentials in Keychain.
The device credential never leaves Rust; the newly generated client bearer is
shown once in the owned Settings surface so the user can copy it to the chosen
cloud MCP client. The non-secret relay URL may persist as an installation
preference. Credentials are bound to the relay URL used to create them, so
changing relays requires a new pairing rather than sending an existing device
secret to another host. Remove pairing disconnects the session and deletes both
credentials from Keychain. Switching vaults waits for any in-flight request and
disconnects the current remote session before activation completes.

Rotli does not automatically upload diagnostics. Support reports should follow
[`docs/operations/support-and-diagnostics.md`](docs/operations/support-and-diagnostics.md)
and exclude private content, paths, and credentials.

## Retention and deletion

Rotli does not retain a server-side copy of the memex because no Rotli content
service exists. Users control local retention through their filesystem and
backup tools. Provider, mail, Signal, GitHub, and web services apply their own
retention policies to data deliberately sent to them.

This document describes the current beta architecture, not legal advice or a
future online service. Update it whenever a data class, destination, retention
behavior, or user control changes.
