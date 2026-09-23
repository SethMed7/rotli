---
title: What is Rotli Helper?
description: A small program on your own computer that lets Rotli Web save notes into your vault folder, in browsers that can't, and chat through the AI tools you already have.
section: resource
date: 2026-09-16
---

Rotli Web keeps every note as a file in a vault folder on your computer. Chrome, Edge, and Arc can
write to a folder themselves. Zen, Firefox, and Brave can't, and no browser tab can start an AI tool.
**Rotli Helper** is the bridge: a small program on your computer that reads and writes the one folder
you choose, and passes a chat message to an AI tool you already have — Claude Code, Codex, or Cursor —
and hands the reply back.

In Chrome, Edge, and Arc you only need it for **chat on the web**. The Mac app never needs it.

## Install it

One line in a terminal downloads it, checks it, and starts it. Rotli Web's setup screen gives you the
line for your computer, already pointed back at the page:

**Mac and Linux**

```sh
curl -fsSL https://rotli.co/helper/install.sh | sh -s -- --open https://rotli.co/app/
```

**Windows (PowerShell)**

```powershell
irm https://rotli.co/helper/install.ps1 | iex
```

It installs to `~/.rotli/bin` and starts by itself whenever you log in. No admin password, no edits to
your PATH. Run the same line again to update it; add `--uninstall` to remove it.

## Pair it with the page

1. The installer opens Rotli Web with this computer's **pairing code** already filled in.
2. Press **Pair**. If your browser asks whether the page may connect to apps on this device, choose
   **Allow**.
3. Rotli Web says the helper is paired. Press **Continue** and choose your vault folder with your
   computer's own folder picker.

The installer also prints the code, so you can paste it into setup (or **Chat → Connect**) yourself.
The pairing survives restarts.

## What it can and can't reach

- It listens **only on your own computer**. Nothing on your network or the internet can connect to it.
- It answers **only pages from rotli.co**, and only a page that has your pairing code.
- It reads and writes **only the folder you chose**. A change you make in Rotli Web is written straight
  into that folder on your computer; nothing is sent over the internet.
- A note in a secure folder, or one carrying a secret, **never reaches a model**.
- Images aren't sent to chat through it yet. Drop images into a note instead.

## Browsers

Chrome, Edge, Arc, Brave, Firefox, and Zen can reach the helper. **Safari can't**: it blocks pages from
talking to programs on your computer.

## If something goes wrong

- **"Nothing answered"**: your browser may be waiting for you to allow the connection. Look for the
  icon at the left of the address bar and choose **Allow**. If it didn't ask, the helper isn't running:
  run the install line again to start it.
- **"Pair again"**: the code the page has is stale. Run `~/.rotli/bin/rotli-helper --print-code` and
  paste the new one. `--reset-token` makes a fresh code and drops the old one.
- **"Older than this page"**: run the install line again to update the helper.
