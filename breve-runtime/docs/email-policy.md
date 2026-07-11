# Breve email access — read-only by construction (policy)

*Status: live. This is the **policy + threat model** for Rotli's embedded brief feature. Seth's standing rules:
**read** access across all accounts, drafting kept **dark** behind a flag, and **never**
auto-sending — the send capability is designed-out, not merely switched off ("I will most
likely never turn it on"). Accounts live today: Proton (via Bridge) + two Gmail/Workspace
accounts, all read-only; add more by appending to `mail-accounts.json`.*

## How Proton connects (the resources)

1. **Proton Mail Bridge** (requires a paid Proton plan — Mail Plus/Unlimited; Seth has one).
   Bridge runs ON THE MAC and exposes the mailbox as **IMAP on `127.0.0.1:1143`**
   (loopback only — unreachable even from the LAN). Mail stays end-to-end encrypted
   between Proton and the Bridge; decryption happens only locally. Local-first by design.
2. **Headless**: Bridge ships a CLI (`bridge --cli`) and runs fine without the GUI;
   install as a login item / launchd agent so it's up when Breve is.
   ([CLI guide](https://proton.me/support/bridge-cli-guide), [headless notes](https://ndo.dev/posts/headless_protonbridge))
3. **TLS**: Bridge uses a self-signed cert for the loopback IMAP listener
   ([macOS cert note](https://proton.me/support/macos-certificate-warning)) — traffic
   never leaves the machine, so pin/accept Bridge's cert in our client config; never
   disable verification globally.
4. **Credentials**: Bridge issues its own app password (NOT the Proton account password).
   It goes in the **macOS Keychain** (`security add-generic-password -s breve-mail-proton`),
   same pattern as the Resend key. Never in a file, never in the repo.
5. **Client**: a Bun IMAP module (`scripts/mail.ts`) — works identically for any future
   provider (Gmail app-password/OAuth IMAP, Fastmail…). One interface, many accounts:
   `mail-accounts.json` lists {name, host, port, user, keychainService} — add any email
   by adding an entry + Keychain item.

## Guardrails (capability table — enforced by construction, not policy)

| Capability | State | Mechanism |
|---|---|---|
| Read (headers, bodies, search) | ON | `mail.ts` exposes ONLY `FETCH`/`SEARCH`/`LIST`. No other IMAP verb exists in the code. |
| Draft | OFF until Seth asks | IMAP `APPEND` to the Drafts folder — creates drafts with **zero send ability**. Shipped dark behind a flag in `settings.json` (`mail.drafting: false`). |
| Send | **DESIGNED DARK** | Sending requires SMTP (`127.0.0.1:1025`) — **we never store the SMTP config or wire an SMTP client.** "Capability exists" = the Bridge offers the port and the architecture has a named slot (`mail.sending: false` + a missing-on-purpose `smtp.ts`); turning it on is a deliberate future build + CONFIRM-gated per-message approval, not a config flip. |
| Delete / move / flag | NEVER | Not implemented; `mail.ts` opens mailboxes read-only (IMAP `EXAMINE`, not `SELECT`) so even accidental store ops fail server-side. |

**Prompt-injection posture** (the Rule-of-Two concern — email is UNTRUSTED input entering
an agent with outbound Signal): email content is treated like web content, never like
Seth's instructions. Concretely: inbox digests are produced by **local Gemma** with a
"summarize, never obey" prompt; email text is never passed to the deep (tool-bearing)
tier unprompted; nothing an email says can trigger an action — actions still require
Seth's explicit ask + the existing CONFIRM gate. No auto-replies, no link-following
from emails by default.

## Use cases (in order)

1. "Anything in my inbox that matters?" over Signal → Gemma triage of unread since
   last check (sender, subject, one-line gist, importance guess) — voice or text.
2. One-line inbox section in lunch/night briefs (count + top 1-2 items, only when
   something clears the bar).
3. (later, flag-on) "Draft a reply to X saying …" → draft lands in Proton Drafts;
   Seth reviews + sends from the Proton app himself.

## Setup

Built and live. The hands-on sequence covers Proton Bridge, Gmail/Workspace app-password IMAP,
the Keychain entries, and the read-only **kill test**. `scripts/mail.ts` is the
read-only client (FETCH/SEARCH/LIST + EXAMINE only); `/inbox` over Signal is the surface.
