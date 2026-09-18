---
title: What is Rotli Helper?
description: A small program you run on your own computer so Rotli Web can chat through the AI tools you already have.
section: resource
date: 2026-09-16
---

Rotli Web runs in a browser tab, and a browser tab can't run an AI model or start a program on your
computer. **Rotli Helper** is the bridge: a small program you run yourself that passes a chat message
from the page to an AI tool already installed on your computer — Claude Code, Codex, or Cursor — and
hands the reply back.

You only need it for **chat on the web**. Notes, tasks, links, and everything else in Rotli Web work
without it, and the Mac app never needs it.

## Install and start it

One line in a terminal downloads it, checks it, and starts it.

**Mac and Linux**

```sh
curl -fsSL https://rotli.co/helper/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://rotli.co/helper/install.ps1 | iex
```

It installs to `~/.rotli/bin` and changes nothing else: no admin password, no background service, no
edits to your PATH.

## Connect the page

1. The helper prints a **pairing code** when it starts.
2. In Rotli Web, open **Chat → Connect** and paste the code.
3. If your browser asks to allow local network access, allow it.

Once connected, Rotli Web checks which AI tools are installed and signed in, and chat works. Keep the
helper's window open while you chat; **Ctrl+C** stops it. To start it again later, run
`~/.rotli/bin/rotli-helper`. The pairing survives a restart.

## What it can and can't reach

- It listens **only on your own computer**. Nothing on your network or the internet can connect to it.
- It answers **only pages from rotli.co**, and only a page that has your pairing code.
- A note in a secure folder, or one carrying a secret, **never reaches a model**.
- Images aren't sent through it yet. Drop images into a note instead.

## Browsers

Chrome, Edge, Arc, Brave, and Firefox can reach the helper. **Safari can't**: it blocks pages from
talking to programs on your computer.

## If something goes wrong

- **"Pair again"**: the code the page has is stale. Run `~/.rotli/bin/rotli-helper --print-code` and
  paste the new one into Chat → Connect. `--reset-token` makes a fresh code and drops the old one.
- **The page can't find the helper**: make sure its window is still open, and that you allowed local
  network access when the browser asked.
- **Remove it**: delete `~/.rotli/bin/rotli-helper`.
