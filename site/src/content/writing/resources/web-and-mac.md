---
title: rotli in the browser and on the Mac
description: What Rotli Web does, where its notes live, and what stays in the Mac app.
section: resource
date: 2026-09-17
---

rotli comes two ways: **the Mac app**, and **Rotli Web**, the same editor served from rotli.co. Neither
needs an account.

## What they share

The editor, folders, tasks, wikilinks, Main and named views, themes, and settings. A note written in one
opens in the other, because both read the same ordinary files.

## Where Rotli Web keeps your notes

Every note is a real file in a folder on your computer, the same files the Mac app reads. Rotli Web
asks for that folder before anything opens.

- **Chrome, Edge, or Arc** open the folder directly.
- **Firefox, Safari, and other browsers** can't write to a folder themselves, so they use
  [Rotli Helper](/resources/rotli-helper/), a small program on your computer that reads and writes the
  one folder you pick.

The page can't send your notes anywhere. Its security policy only allows it to connect to Rotli Helper,
and only if you run it on your own computer.

## Chat on the web

Rotli Web chats through **Rotli Helper**, a small program you run on your own computer (Mac, Windows, or
Linux). It passes your message to AI tools you already have installed, like Claude Code or Codex, with
your notes as context. Notes in a secure folder, or carrying a secret, never reach a model.

## What stays in the Mac app

The Librarian, Breve, Word and sheet files, running models directly, and dragging files in from Finder.
