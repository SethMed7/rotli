---
name: index-and-log
description: Keep the Librarian index (a one-line summary per note) and the Librarian log (what you did, and to which notes). Both live in Rotli, not in the vault, and every note is named by id.
---

# Index and log

The index and the log are yours, and they are not notes. Rotli keeps them
beside the vault and shows them through `librarian_index_read`, which renders
them as they stand now: each note under its current title, and only the
entries about notes you may still read. You never write a note's title into
either; Rotli fills it in when it renders.

## librarian_index {entries, remove?}

Sets the one-line summary the index keeps for each note:

```json
{"entries": [
  {"id": "01J…", "summary": "the Q3 launch plan and its decisions"},
  {"id": "01K…", "summary": "design lead, Northwind"}
]}
```

- One entry per note, by the note's id from `librarian_search` or
  `librarian_read`. Writing an id again replaces its summary; `remove` takes
  notes the index already holds out of it.
- Every id must be a note you can read now that carries its own Rotli id (a
  note known only by its file path can't be indexed or logged), or the whole
  call is refused.
- The summary is one line about that note. Don't name other notes in it; give
  each its own entry. Text that names a note you can't read is refused, and
  an entry whose text names a note that later becomes hidden stops showing.
- Keep it to the wiki's main pages: a few hundred entries at most.

## librarian_log {entry, ids?}

Appends one line to the log, with the ids of the notes it concerns:

```json
{"entry": "Left these recipe notes in intake: no Cooking area yet", "ids": ["01J…", "01K…"]}
```

- Always pass the ids of the notes a line is about, and never write their
  titles in the text. A line is shown only while every note it names is one
  you may read, and is hidden too when its text contains the title or an
  alias of a note you can't read; a note named in other words (a nickname, a
  description) can't be recognised that way.
- Captures and proposals already log themselves.

## librarian_index_read {logLines?}

Returns the index and the newest log lines. Read it before you refresh the
index, so you add what's missing instead of repeating what's there. What you
can't see isn't there for you: never mention that anything was withheld.
