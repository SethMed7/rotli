# rotli

rotli is a warm, local-first, hotkey-driven notes app for the Mac menu bar — one shell, six fronts
over one brain (Notes · Chat · Voice · the Memory · Inbox · Board). The brain is a corpus of plain
markdown files on your own machine; the app opens and closes in the blink of `⌥Space`, works fully
offline, and stays quiet — no badges, no spinners, no noise. Built with Tauri v2 + React + Vite +
TypeScript (strict) on Bun, styled with plain CSS driven entirely by the frozen rotli brand kit
(vendored at `src/brand/`, kit 1.0.0 — read-only).

## Stage 1 status

Everything lives **in memory** — reloading the app wipes all notes. That is deliberate: Stage 1
builds the full UI against typed in-memory services; persistence (the markdown corpus + index)
arrives in a later stage.

## Run

```sh
bun install
bun run tauri dev   # the desktop app
bun run dev         # frontend only, in a plain browser (http://localhost:1420)
bun run check       # tsc --noEmit + raw-hex lint
```
