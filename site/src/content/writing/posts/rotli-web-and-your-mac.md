---
title: Why Rotli Web talks to your computer through Terminal
description: Rotli Web keeps your notes in a folder on your computer, not on a server. How Rotli Helper makes that work, what its one-line install does, and what it can and can't reach.
section: post
date: 2026-10-02
---

Rotli Web is the rotli editor, served from rotli.co. It has no account and no server that holds your
notes. Every note is a plain Markdown file in a folder on your own computer, the same files the Mac app
reads. That promise is easy to keep in a Mac app. In a web page it takes some explaining, and in some
browsers it takes a small program you install with one line in Terminal. This post covers why, and what
that line does.

## The short answer

A web page can't normally reach a folder on your computer, and it can never start a program. Rotli Web
needs both: a folder to keep notes in and, for chat, the AI tools you already have installed. Chrome,
Edge, and Arc can open a folder themselves. Everywhere else, and for chat in every browser, **Rotli
Helper** does the reaching: a small program that runs on your computer, listens only on your computer,
and reads and writes only the one folder you choose.

## A browser and your folder

Rotli Web won't open without a vault folder. There is no copy of your notes kept inside the browser and
no read-only stand-in. If the folder can't be reached, you see a screen that says so and names the fix.

How the page reaches the folder depends on the browser:

- **Chrome, Edge, and Arc** have a folder API. You pick the folder with the browser's own picker, and
  the page reads and writes it directly. Chromium asks again on your next visit; choosing **Allow on
  every visit** makes that silent.
- **Firefox, Zen, and Brave** (with its folder flag off) have no such API, so they use Rotli Helper.
- **Safari, phones, and tablets** aren't supported yet. They have no folder API, and Safari won't let a
  secure page talk to a program on your computer.

Above either road the code is the same, so notes and chats behave alike.

## Why not a sync server

The usual way to put an editor in a browser is to keep the notes on a server and sync them. That puts a
copy of your notes on someone else's machines, which is the one thing rotli is built to avoid.

Chat made the choice sharper. Chat in rotli runs AI tools you already use, like Claude Code or Codex,
signed in with your own account. A browser can't run them. We could have run them on a server, but then
your login to each tool would live with us, and a relay would see every message on its way through.
Instead the tool runs where it already lives: on your computer, started by a helper you installed.

The helper isn't the Mac app in disguise, either. Part of the point of Rotli Web is that Windows and
Linux can use rotli before there is a native app for them, so Rotli Helper is its own small program for
Mac, Windows, and Linux.

## What the one line does

On a Mac or Linux, Rotli Web's setup screen gives you one line to paste into Terminal:

```sh
curl -fsSL https://rotli.co/helper/install.sh | sh -s -- --open https://rotli.co/app/
```

On Windows it's a PowerShell line: `irm https://rotli.co/helper/install.ps1 | iex`. Piping a script
into a shell deserves suspicion, so here is what the Mac and Linux script does:

1. Works out your system and processor, and downloads the matching prebuilt `rotli-helper` from rotli's
   releases on GitHub.
2. Checks the download's SHA-256 against the checksum file published with that release. If the file
   has no entry for your download, the hash doesn't match, or your computer has no way to compute one,
   it stops and installs nothing.
3. Puts the program in `~/.rotli/bin`. It doesn't ask for an admin password or edit your PATH.
4. Registers it to start when you log in: a LaunchAgent named `co.rotli.helper` on a Mac, a systemd
   user service on Linux. The Windows script uses a Startup shortcut.
5. Waits until it answers on `127.0.0.1`, prints its pairing code, and opens Rotli Web with that code.

`--open` accepts only Rotli Web's own address; given anything else, the script refuses before it does
anything. You can read [the whole script](/helper/install.sh) before you run it, and running the same
line again updates the helper.

## Pairing the page

The pairing code travels in the part of the address after `#`, which browsers never send to a server.
The page reads it, removes it from the address bar, and shows it filled in on the setup screen. You
press **Pair**.

Your browser may ask first. Firefox and Zen ask whether the site may connect to apps on this device;
Chromium browsers have their own local-network prompt. Choose **Allow**. Rotli Web then says the helper
is paired and what it can and can't reach. Press **Continue** and pick your vault with your computer's
own folder picker. The page learns only the folder's name.

## What the Helper can reach, and what it can't

- It listens **only on your own computer**. Nothing on your network or the internet can connect to it.
- It answers **only pages from rotli.co**, and only one that holds your pairing code.
- It reads and writes **only the folder you picked**, and the page can't pick another. Paths that try
  to climb out are refused, links to elsewhere aren't followed, nothing inside a `.git` folder is
  written, and a folder that holds the helper's own settings, like your whole home folder, is refused.
- It never overwrites a newer version. Each save names the version of the file it started from, and a
  save made against an older version is refused rather than clobbering a change made since.
- For chat, it runs your own AI tool, which contacts its provider the way it does from Terminal.
  **Secure notes are refused before the tool runs.** Images aren't sent to chat through it yet.

On the page's side, Rotli Web's security policy lets it load only its own files and connect to nothing
but the helper on your computer. Even an image in a note that points at a website isn't fetched. If the
helper stops mid-session, the page says it is reconnecting and holds your edits until it answers again.
Unsaved typing is kept briefly in the browser so a refresh can't lose it, then written to your folder
and cleared.

## Stopping it, or removing it

The same script removes it:

```sh
curl -fsSL https://rotli.co/helper/install.sh | sh -s -- --uninstall
```

That stops the helper and removes the login item and the program. Your vault folder is untouched. The
pairing code and your folder choice stay in `~/.rotli-helper`; delete that folder to forget them too. On
Windows, the script takes `-Uninstall`.

## The trade-offs

You install a program and have to trust it, which is why the script checks what it downloads and why
this post spells out what it does. Your browser may ask permission
before the first connection. Safari and phones are left out for now, images in chat wait for a later
version, and some of rotli, like the Librarian and Word documents, stays in the Mac app.

It isn't instant on a big vault, either. On a 900-note, 14 MB vault in Firefox, a full reload through
the helper takes about 1.3 seconds.

In return, there is no copy of your notes on anyone's server, no account to lose, and no login to your
AI tools held by us. The page is just the editor. Your folder stays on your computer, where you can open
it in any other app, or delete rotli and keep every word.

What connects where, in full: [Privacy](/privacy/#web). Setup help: [What is Rotli
Helper?](/resources/rotli-helper/)
