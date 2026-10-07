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

- the signed updater checks for a newer version: shortly after the app opens
  and a few times a day, and whenever you press "Check for updates". It asks
  rotli.co first, with Rotli's version, macOS, and the chip type in the
  address (so rotli.co's traffic shows how many Macs run each version), and
  rotli.co redirects the app to the signed release feed on GitHub; if
  rotli.co is unreachable the app asks GitHub directly. The request carries no account,
  identifier, vault, or note data.
  Settings → General → "Check for updates automatically" turns the routine
  check off; nothing is downloaded until you choose Install;
- a user-enabled connected chat lane launches the already-authenticated official
  Claude Code, Codex, or Cursor client on the same Mac; that client sends the
  bounded conversation/context needed for the request under its provider's
  terms. Cursor is exposed only as a software/code-chat lane through its ACP
  custom-client protocol in read-only Ask mode;
- web search/fetch sends the query or URL needed for the explicit web action;
- user-configured Breve email, Signal, mail, and watch services contact their
  configured destinations; Breve model generation itself stays on-device
  (Breve is available in development builds only today); and
- when the user explicitly connects Remote agents for the current app session
  (development builds only today),
  Rotli sends authenticated MCP request/response frames through the configured
  HTTPS relay. The relay keeps only in-flight frames in memory and stores no
  vault or Markdown; the cloud MCP client receives the non-secure workspace
  data requested through approved tools.

Rotli never embeds a provider login, reads provider authentication files, or
stores provider credentials. Provider defaults and routing tags are ordinary
vault settings/transcript text, never credentials. Antigravity subscription and
direct Gemini model execution are disabled, as are provider-backed image
generation and subscription-CLI use by Breve/background jobs. Google permits
separately billed AI Studio/Vertex API routes, but Rotli does not implement
either route.

The destination inventory and guards are documented in
[`docs/development/security.md`](docs/development/security.md). Adding telemetry,
an account service, crash upload, sync, or another destination requires an
explicit privacy and threat-model change before implementation.

## Rotli Web

Rotli Web (`rotli.co/app/`) keeps every note as a file in a vault folder on
your computer; it has no browser-storage vault. The page loads only its own
files and its security policy lets it contact nothing but `127.0.0.1` — Rotli
Helper on the same computer, for browsers without a folder API. The helper
listens on `127.0.0.1` only, reads and writes only the one folder you choose
with your computer's own folder picker, and starts when you log in (remove it
with the installer's `--uninstall`). The installer hands the page its pairing
code in the address's `#` fragment, which browsers never send to a server.
Unsaved typing is held briefly in this browser's local storage so a refresh
can't lose it, then written into the vault and cleared. The one outbound path
is a chat you start: the helper runs your own AI tool, which contacts its
provider as above, and secure notes are refused before it runs.

## The rotli.co website

rotli.co sets no cookies and runs no analytics, ads, or third-party scripts.
Its pages, fonts, images, and films are served from the site itself. The one
exception is the Launch Llama badge in the footer, an image loaded from Launch
Llama's own server, which therefore sees a request from the visitor's browser.
The star count beside the header's GitHub link is read from GitHub's public
API once, when the site is built; the visitor's browser never contacts GitHub
to show it. Railway (hosting) and Cloudflare (DNS) process standard request details such
as the IP address to deliver pages.

The footer's optional "Hear when it's ready" list sends the address a visitor
types to Resend, Rotli's email provider, and only when the visitor submits it.
Resend keeps it as a contact in Rotli's list (a Resend segment) so the owner
can email updates about Rotli. Every such email carries Resend's unsubscribe
link, and one click removes the address from future sends. When an address
joins, the owner also receives one email with it, sent through the same
Resend account, as a signup alert. Nothing else is collected or shared. Until the list opens, the form says so and the address
is not kept or passed on.

The roadmap page (rotli.co/roadmap/) keeps a vote count per roadmap item and
nothing about who voted. The visitor's browser remembers its own votes in
local storage (not a cookie, never sent). Abuse limits use an HMAC of the IP
address and the UTC day under a secret salt, held in the server's memory only:
never the raw address, never written to disk, new every day, and gone on
restart. A feature request stores its title, description, the time it
arrived, and an email address only if the visitor gives one, in a SQLite file
on the site's Railway volume. Requests are read only by the owner, never
published, and never added to the email list; a visitor can ask for theirs to
be deleted by sending another request.

## Secure notes and locked notes

Secure notes are excluded from remote models, remote search observations, and
the organizer. Recognized on-device models — which cannot make a network call —
read them by default; that can be turned off for one note from its menu or for
the whole vault in Settings → Security. Nothing turns it on for a remote model.

Locked notes are a separate control: no AI of any kind may edit a locked note,
cloud or on-device. Locking withholds editing, not reading.

A note a person wrote is theirs. No AI rewrites its text until the person turns
on "Let AI edit the text" for that note from its menu (`ai_edit: true`). Notes a
chat, an agent, or `/librarian` created carry `created_by` and stay editable by
AI unless locked or set to `ai_edit: false`. Ask AI's Insert adds one passage the
person accepted and cannot remove or change their text; it is refused on locked
notes and on `ai_edit: false`. The Librarian writes only its own metadata fields
at the top of a note and may move the file into its area folder; it never
changes the note's text, and it skips secure and locked notes. The rules are in
[`docs/decisions/2026-09-29-ai-body-edit-permission.md`](docs/decisions/2026-09-29-ai-body-edit-permission.md)
and [`docs/design/ai-visibility-matrix.md`](docs/design/ai-visibility-matrix.md).

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
