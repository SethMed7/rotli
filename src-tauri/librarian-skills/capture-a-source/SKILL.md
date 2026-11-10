---
name: capture-a-source
description: Bring a raw source into a vault with librarian_capture — what to keep verbatim, how to title it, and how to cite where it came from.
---

# Capture a source

`librarian_capture {title, body, source?}` writes one new note into the vault's
intake folder and logs it.

- **Title:** short and specific, one line, no `#`. "Q3 pricing call — Ana",
  not "Notes".
- **Body:** the material as the person gave it. Keep their words. You may add
  a two-line summary at the top under `## Summary`, clearly yours; never
  rewrite the source below it.
- **Source:** a URL, a file name, or "conversation". It is added as a
  `Source:` line at the end.
- One source per note. Split a pasted bundle into several captures.
- Search first; if the same source is already captured, don't capture it
  again — propose a link instead.
- Secret-shaped text (keys, tokens, card or ID numbers) is refused. Tell the
  person to make that note secure in Rotli themselves.
