# Antigravity returns as a connected lane through Google's official ACP agent

- Status: accepted
- Date: 2026-09-03
- Deciders: Seth Medina
- Supersedes: the 0.84.0 removal of the `agy` CLI lane (CHANGELOG 0.84.0 "Removed")

## Context

Rotli 0.84.0 removed the Antigravity lane. That lane drove the `agy` IDE
command line with `-p` and inherited the IDE's Google login, and Google's
Antigravity FAQ said third-party tools may not reuse an Antigravity login and
that doing so could suspend or terminate the account. Rotli's stated boundary
is that a connected provider is enabled only through that company's
**published client or integration route**; the IDE's login was not one.

Two things changed on 2026-09-02:

1. Google publishes an official **Antigravity ACP agent** on the Agent Client
   Protocol registry (`agentclientprotocol/registry`, `antigravity-acp/agent.json`,
   Google LLC as author, proprietary licence). It is a signed Mach-O
   executable pair (`agy_acp_server.par` + `localharness_external`) served from
   `dl.google.com`, with its own Google sign-in (`authenticate`,
   `oauth-personal`), its own credential store (`GEMINI_HOME`), and a model
   list per account. It is the same integration route Zed and T3 Code use.
2. Multiple DeepMind staff stated publicly that the FAQ text is out of date and
   that Google does not enforce it against tools using this route; T3 Code
   shipped the provider in its nightly builds on that basis. The FAQ page still
   carries the old text at the time of writing.

## Decision

Re-add Antigravity as a connected lane **only** through the official ACP
agent, never through the IDE's `agy` command or its login:

- Rotli downloads the registry-listed archive for this platform to
  `~/Library/Application Support/com.rotli.app/antigravity-acp/current/`,
  verifies the pinned SHA-256 and byte size before extracting, and runs the
  executable with a private profile (`GEMINI_HOME` beside it, mode 0700,
  file credential storage). Google-related environment variables from the
  host are stripped from the child.
- Sign-in is the agent's own `authenticate` flow: the agent prints Google's
  authorization URL, Rotli opens it in the default browser, and the agent's
  loopback callback completes the exchange. Rotli never sees or stores a
  token; the agent does, in its profile. Sign-out deletes that profile's
  token file.
- Every chat turn is the same one-shot ACP transport the Cursor lane uses:
  `initialize` with filesystem and terminal capabilities off, `session/new` in
  an empty scratch directory, the requested model selected through
  `session/set_config_option`, every permission request answered with the
  agent's reject option, native questions cancelled, and the no-native-tools
  override prepended so the model follows Rotli's tool protocol. Mode stays
  the agent's `default`; Rotli never selects `yolo`.
- The lane is **off by default**, sits last in the provider list, and its
  settings card states Google's FAQ position and the DeepMind statements so
  the person turning it on knows the account risk is theirs.
- Breve keeps refusing every connected provider; this lane is chat-only.
- Model class stays "remote" (endpoint is not loopback), so secure notes and
  secret-shaped prompts are withheld exactly as for Claude Code and Codex.

## Consequences

- The reviewed model allowlist (`gemini-3.8-flash-{high,medium,low}`,
  `gemini-3.7-flash-{high,medium,low}`) is taken from the agent's current
  offering as observed by T3 Code on 2026-09-02; Rotli validates a requested
  id against the agent's returned `configOptions` and names the available
  ids on mismatch. Updating the roster is a two-file, parity-pinned change.
- A cold start of the agent costs about six seconds on first launch and about
  one second afterwards (measured 2026-09-03 on Apple Silicon); the one-shot
  transport keeps Rotli's transcript as the only durable history, at the
  price of that startup per turn.
- A new network destination class exists: a pinned-hash runtime download
  from `dl.google.com`. It is listed in the egress allowlist and threat
  model; the agent's own traffic to Google is provider traffic, like Cursor's.
- If Google reverses course or the registry entry disappears, disabling the
  lane is one allowlist edit; Rotli reviews these boundaries and disables a
  route rather than working around a restriction.

## Addendum 2026-09-17 — image attachments

The lane refused images at first ("does not accept image attachments in
Rotli"). The agent's `initialize` result advertises
`agentCapabilities.promptCapabilities.image: true`, so attached images now
ride the `session/prompt` as `{ type: "image", mimeType, data }` blocks
beside the text (`src-tauri/src/acp_images.rs`; the mime follows the bytes'
magic number, not the staged file name). The capability is read per turn:
an agent that advertises no image prompts is refused in words before a byte
is sent. The catalog marks the Antigravity models vision-capable so the
composer's attach button and the drop cue treat them like Claude and Codex.
