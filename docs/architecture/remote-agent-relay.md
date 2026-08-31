# Remote agent relay contract

Rotli can expose `rotli-workspace` to a public HTTPS MCP client without moving
the vault off the Mac. This capability is off at launch and requires the user
to connect it explicitly from Settings → Connections for the current app
session.

## Ownership and flow

The app makes an outbound authenticated long poll to the configured relay. A
cloud `POST /mcp` is accepted only while a matching device poll is already
waiting. The relay hands that frame directly to the Mac, waits for the answer,
and returns it to the client. It keeps only in-flight frames and opaque tokens
in memory, logs no frames, and has no Markdown, corpus, account, or durable
queue store. If Rotli disconnects or quits, new requests fail immediately.

`src-tauri/src/workspace.rs` remains the one application service and tool-schema
owner. Stdio, authenticated loopback HTTP, and the relay connector all call its
same JSON-RPC dispatcher. The connector pins requests to the app's current
default registered vault and opens that root through `CorpusStore`; secure
notes remain omitted, locked writes remain refused, and every update still
requires a fresh revision.

`services/rotli-mcp-relay/` owns only the ephemeral rendezvous protocol:

- `POST /device/poll` waits for one cloud frame for the bearer token;
- `POST /device/respond` completes that exact token-bound request;
- `POST /mcp` is the public stateless streamable-HTTP MCP endpoint; and
- `GET /health` discloses no sessions or user data.

Pairing generates independent role-bound client and device tokens with one
opaque pair id. The Keychain bundle keeps both tokens; only the client bearer is
returned once to the owned Settings webview so the user can copy it into the
cloud MCP client. Device endpoints reject client tokens, client endpoints reject
device tokens, and the relay accepts a client token only when the matching live
device poll declared that exact token. Regeneration replaces the bundle and
stops the old connector, so neither old role can reach that Mac. Tokens are
never written to Markdown or settings JSON. Relay deployments terminate public
TLS; plain HTTP is accepted only for loopback development.

The configured relay URL is a non-secret installation preference. It survives
relaunch, but connection authority does not: every launch remains disconnected.
Switching the active vault also disconnects the connector so an apparently new
workspace cannot leave the cloud client attached to the previous root.

## Public deployment profile

The Railway service uses `services/rotli-mcp-relay/` as its root and the pinned
Dockerfile in that directory. It runs exactly one replica, no database, and no
volume. In-memory rendezvous state cannot be split across replicas; a restart or
deployment intentionally drops every poll and in-flight request, after which an
already-enabled app session reconnects. `/health` is the content-free startup
health check.

The public process rejects browser-originated credentialed calls, requires
exact role-bound bearer syntax and JSON content types, caps frames at 256 KB,
and bounds both waiting devices and in-flight cloud requests. The Bun server
also enforces the body cap before the handler buffers a frame. The service emits
no request, token, note, title, or body logs.

## User control and failure behavior

Pairing does not connect. “Connect this session” starts the outbound loop, and
every app launch begins disconnected even when a token remains paired. The UI
shows disconnected, error, and connected states and offers an explicit
disconnect. Replacing a pairing requires a separate destructive confirmation.
Rotli never edits Grok Bot, Cursor, Claude, or Codex configuration.

The relay does not retry a tool call or retain it for later delivery. A lost Mac
connection expires the in-flight response. Client retries are new MCP calls and
remain subject to normal write approval and optimistic-revision behavior.

Breve needs no relay-specific tools: a remote `rotli_create_note` lands in
intake and Main, where existing Breve retrieval can use it. Additive watchlist
or routine tools are a later workspace-contract change.
