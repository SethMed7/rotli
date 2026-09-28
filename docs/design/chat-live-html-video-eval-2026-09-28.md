# Chat: live HTML previews, and videos made from them (evaluation)

Status: evaluation (2026-09-28), awaiting the owner's go. Owner's words, with a
screenshot of Claude Opus 5.5 in Rotli Chat answering "I can't render a video
file directly in this chat, so I built the showreel as one HTML file … save
this as showreel.html and open it in a browser": "should be able to render
videos in chat since I can do it with Claude directly and Claude can do it —
it should be possible here too, so evaluate this."

Builds on [chat-work-surface-eval-2026-09-27.md](chat-work-surface-eval-2026-09-27.md)
(step 1 there, replies showing vault images and video, is built).

## What Claude does elsewhere, and why Rotli can't yet

On claude.ai a reply's HTML becomes an **artifact**: it runs in a sandboxed
frame on its own origin, so scripts, canvas and animation work, and nothing it
runs can reach the page around it. The showreel in the screenshot is exactly
that kind of thing: a canvas animation, plus a Record button that captures the
canvas with `MediaRecorder`.

Rotli shows the same reply as a code block, because:

- Chat renders an `html` fence as code (`noteChat/chatMessageBlocks.ts`).
- Rotli's content security policy is `script-src 'self'`
  (`src-tauri/tauri.conf.json`). An `<iframe srcdoc>` inherits that policy, so
  the reply's inline `<script>` would not run even if it were shown in a frame.
- The model doesn't know Rotli could show it, so it says it can't.

## What would make it work

1. **A sandboxed origin for model HTML.** Rust registers a custom scheme
   (`rotli-artifact://`) that serves one staged HTML document with **its own
   policy header**:
   `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
   img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'`.
   - **No network:** `connect-src 'none'` and no remote sources, so a reply
     can't send anything anywhere. The rule that model output never becomes an
     egress path holds.
   - **No Rotli:** the frame is `sandbox="allow-scripts"` (no `allow-same-origin`):
     a unique origin, no storage, no access to the parent page, and no Tauri
     capability grants that origin anything.
   - Rotli's own policy only gains `frame-src rotli-artifact:` (and the
     `http://rotli-artifact.localhost` form WebKit uses).
   - A size cap (2 MB) and one staged document per preview, kept in memory.
2. **"Preview" on an `html` fence in a reply** (Chat only, never a note): the
   code block gains Preview ↔ Code, and the preview plays in place at the
   reply's width (16:9 when it's a canvas). It's Mac and Rotli Web alike: the
   web build serves the same document from a blob URL in a sandboxed frame with
   the same policy in a meta tag.
3. **"Save as video."** The preview frame gets a small Rotli-owned helper (a
   script literal in Rust, like the private browser's media scripts). On a
   `postMessage` from Rotli it finds the page's largest canvas, records it
   with `canvas.captureStream()` and `MediaRecorder` (WebKit records MP4) for
   the chosen length, and posts the Blob back. Rotli accepts only that one
   message shape, from that frame, video types only, under a size cap. It
   saves the video to the chat's folder (`storage/chats/<slug>/`), where the
   chat's inline video (already built) plays it, and it lists in the chat's
   files as a video (also built).
4. **Tell the model.** The chat's system prompt adds one line: an `html`
   fence previews live in Rotli, and for a video, draw a canvas animation that
   the person can save as a video here. The model then stops saying "I can't".

## Honest limits

- **It records what a canvas draws.** Motion graphics, kinetic type, charts
  and generative art all work. Footage, voices and photoreal video need a video
  model or a renderer: steps 3–5 of the earlier evaluation, a provider or a
  local ffmpeg/Remotion renderer behind Add-ons.
- **Recording runs in real time.** A 15-second reel takes 15 seconds to
  record. Rotli shows progress, and Stop keeps what was recorded so far.
- **No sound** unless the page makes it with Web Audio. The helper can add
  that track later.
- **Rotli Web:** Chromium records WebM rather than MP4. Both play in Chat.

## Size and order

| Step | Size | Notes |
|---|---|---|
| Sandboxed scheme + policy + Preview on `html` fences | M | Rust protocol, one CSP line, the fence toggle; the security doc gains a row |
| Save as video (helper, message channel, save to the chat folder) | M | Reuses the chat's video type and inline player |
| System-prompt line | S | With an eval so it stops declining |
| A real video model or local renderer | L–XL | Unchanged from the earlier evaluation; the owner's call |

**Recommendation:** build the first three rows as one slice (about two PRs).
The showreel in the screenshot would then play inside the reply and save as
an MP4 in the chat, with nothing leaving the Mac.

## Decisions for the owner

1. Go on the sandboxed preview? It's the first time Rotli would run
   model-written scripts, even without network or access to Rotli.
2. Should Save as video offer the recording length, or read it from the page
   (`data-duration`), defaulting to 15 seconds?
