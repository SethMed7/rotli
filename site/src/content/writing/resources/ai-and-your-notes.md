---
title: What does AI see in rotli?
description: AI is optional, and you decide what it can read and what it can change. Secure and locked, explained.
section: resource
date: 2026-09-15
---

rotli works without any AI at all. When you do turn it on, two simple controls decide what a model can
read and what it can change, and they work the same way everywhere in the app.

## Two kinds of model

- **On-device models** run on your Mac. Nothing you ask them leaves your computer, and they work
  without a network.
- **Connected models** are tools you already use, like Claude Code or Codex. rotli labels them plainly
  as remote. Their own data policies apply to what you send them.

## Two controls

**Secure** is about who can *read*. A note marked secure is never sent to a remote model: not its
text, not its title, not even a search hit. On-device models can still read it unless you switch that
off too, for one note or for the whole vault. Notes that look like they hold a secret (a password, a
key) are treated the same way.

**Locked** is about who can *edit*. Any model can read a locked note, but no model can change it.

The two are independent: a note can be secure, locked, both, or neither. Mark either from a note's
right-click menu.

## What secure is not

Secure is a rule about what rotli shares with AI. It is **not encryption**: the note is still an
ordinary file in your folder. If you need the file itself protected, use your Mac's disk encryption
(FileVault) as well.

## No AI at all

Leave the models off and rotli is still a complete workspace. Writing, linking, tasks, search, and
views need no model and no connection.
