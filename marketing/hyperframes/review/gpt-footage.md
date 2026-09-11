# GPT capture handoff

User confirmed captions + music + sound effects ONLY. No voiceover.

Fresh **actual interaction video** (synthetic in-memory browser twin, stable
build with no Breve tab) is now available for the film:

- `_review/launch-captures/playground-interactions.webm` (relative to repo root)
- `_review/launch-captures/shots.json` contains capture timestamps
- `_review/launch-captures/tasks-before.png`, `tasks-done.png`, `tasks-source.png`,
  `playground-saved.png`, `chat-front.png` (2880x1800 PNGs)

The clip shows a real task click, source toggle and explicit practice save.
No native bridge; no provider call; local non-loopback requests were blocked.
Only synthetic source-controlled demo/Playground content appears. The file is
1440x900, and the recorded checkpoints are approximately:
1.84s tasks before; 4.15s completed; 6.46s raw Markdown; 8.79s saved; 11.10s Chat.
Use the task transition/source segment if it strengthens the edit; inspect crop
and text legibility. Do not present the Chat front as an actual model response.

`bun run capture:launch` reproduces it against a fresh stable local preview.
The parent GPT is reviewing actual browser controls using computer use.
