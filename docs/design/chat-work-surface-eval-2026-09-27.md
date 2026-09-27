# Chat as a work surface — evaluation (2026-09-27)

Round Three asked: can Chat work like Claude Cowork for work that isn't code,
for example "ask Opus for a video, get it back, and watch it in the chat"?
This is a code-reading evaluation (nothing run); every claim cites where it
lives. Owning contracts: [security.md](../development/security.md),
[egress-threat-model.md](../architecture/egress-threat-model.md), and
[ai-visibility-matrix.md](ai-visibility-matrix.md).

**Short answer:** not today. Opus can drive Rotli's own tools, but no tool
makes or fetches video, and nothing a model produces is shown inside the
thread. Playback already works everywhere else in Rotli.

## How Chat runs a model

Two layers:

1. **The vendor layer is tool-less by design.** Connected CLIs run with their
   own tools, MCP servers, plugins, and file writes switched off:
   Claude Code `-p --safe-mode --tools ""` (image turns add only
   `--tools Read` on a temp image folder); Codex `--sandbox read-only` with
   the shell tool off; Cursor and Antigravity over ACP with `mcpServers: []`,
   no file-system or terminal capability, and every permission request
   refused (`src-tauri/src/provider.rs`, `src-tauri/src/acp.rs`).
2. **Rotli's own tool loop runs on top, for every lane.** Each step is one
   tool-less CLI call; the model answers in a JSON protocol and Rotli runs the
   tool (`src/ai/loop.ts`, `src/ai/tools.ts`, `src/ai/host.ts`). Steps are
   synchronous, 180 s by default (600 s cap).

## What Chat can do today

| Capability | State |
|---|---|
| Notes: search, read, create, update, open; read files | Always |
| Create a Word document, a PDF (from an editable note), a sheet (when Sheets is on), a board from Mermaid | Mac app |
| Web search and fetch | Only with the chat's globe on |
| Image generation | Off by policy (egress route 4); `/image-gen` is a stub |
| MCP client (call outside tools) | None. Rotli is an MCP *server* only |
| Artifacts rail | Lists files a turn created, `storage:` links in the transcript, and anything under `storage/chats/<slug>/` |

## What Chat can show

| In a reply | State |
|---|---|
| Markdown text, code with copy, tables, Mermaid | Yes |
| An image written as Markdown (`!` + link to a `storage:` file) | No — shows as literal text |
| `storage:` links | Dead links (still listed in the rail) |
| Video | No inline player; the rail shows an mp4 as a generic file, and opening it plays it in the file viewer (code reading, not run) |
| Images the person attached | Yes, in their own messages |

Video playback already exists in the file viewer, the preview window, and note
embeds (an image-style link to a `storage:` video), and the content policy
allows it. AGENTS.md
names video as a preview-only surface, so showing it inline breaks no law.

## The path to "make a video and watch it here"

| Step | Size | Notes |
|---|---|---|
| 1. Show images and video inline in replies; a `video` artifact type and chip | S–M | No policy change. **Built 2026-09-27** (inline media; the rail's `video` type is still owed) |
| 2. Accept video dropped into a chat (TS list + Rust twin) | S–M | No policy change |
| 3. A `generate_video` tool that writes into `storage/chats/<slug>/` | M | Must join the egress tool list, the secret and secure-note checks, and `check:security` (its tool scan reads only `WEB_TOOLS` / `IMAGE_TOOLS` arrays) |
| 4. Long-running jobs: progress, cancel, survive a restart | M–L | Today every step is synchronous and capped |
| 5. The video provider itself, behind a Rust adapter with a Keychain credential | L–XL | Needs the Add-ons system and an owner call on provider policy. A fully local renderer (for example ffmpeg or Remotion with no network) avoids the terms-of-service question that retired subscription-routed image generation |
| 6. A general MCP client, so a video MCP server can be used | L | Probably through Add-ons; every MCP tool is off-device and must pass the same gates |
| Letting the CLIs use their own tools and MCP | XL | Not recommended: it reverses the security posture that keeps secure notes and secrets inside Rotli |

**Recommendation:** do 1 and 2 first (small, no policy change, and useful now:
a model that writes a chart image or a clip into the chat folder becomes
visible). Then decide the provider question (5) together with the Add-ons
system, and build 3–4 on top of it. Keep the CLIs tool-less.

## Owner decisions

1. Which video source: a paid API behind Add-ons, a local renderer, or both?
2. Should a general MCP client come before any single media tool?

## Drift noticed

The egress threat model's lane table still lists Antigravity as unavailable,
but it ships (see the 2026-09-03 Antigravity decision and `provider.rs`).
