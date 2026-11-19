---
name: index-and-log
description: Keep the vault's Librarian index and Librarian log pages — the two pages the Librarian owns and may rewrite.
---

# Index and log

These two pages are yours. Rotli creates them on first use, marked as made by
an agent, so you may rewrite them. You may not rewrite any other page.

## librarian_index {body}

Replaces the whole body of "Librarian index". Shape:

```markdown
## Projects
- [[Payments launch]] — the Q3 launch plan and its decisions.

## People
- [[Ana Ruiz]] — design lead, Northwind.
```

- One line per page: a wikilink and a one-line summary.
- Group by the vault's own areas. Keep it under about 300 lines; link to area
  pages instead of listing everything in a large vault.
- Only pages you can read appear. Never mention that anything was withheld.

## librarian_log {entry}

Appends one dated line to "Librarian log". Use it for decisions worth
remembering ("Left 4 recipe notes in intake: no Cooking area yet"). Captures
and proposals already log themselves.
