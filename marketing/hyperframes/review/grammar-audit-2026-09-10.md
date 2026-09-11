# Grammar audit — 2026-09-10T13:04:03.275Z

Read-only render audit of the stable browser twin at working-tree HEAD (0.90.0, installed app is 0.89.0), produced by `bun scripts/audit-grammar.mjs http://127.0.0.1:1431`. Screenshots live in the ignored `_review/grammar-audit/`.

- lessons rendered: writing, tasks, choices, tables
- ok   typed "[] Open task" -> "- [ ] Open task"
- ok   typed "[/] In progress task" -> "- [/] In progress task"
- ok   typed "[x] Done task" -> "- [x] Done task"
- ok   typed "[][] Pass or fail result" -> "- [ ][ ] Pass or fail result"
- ok   typed "[True][False] Labeled result" -> "- [True][False] Labeled result"
- ok   typed "[True:green][Draw:yellow][False:red] Colored result" -> "- [True:green][Draw:yellow][False:red] Colored result"
- ok   typed "[Yes:#E3B341][No:purple] Hex and purple" -> "- [Yes:#E3B341][No:purple] Hex and purple"
- ok   typed "[#] Single choice" -> "- [#] Single choice"
- ok   typed "[##?] Multi prompt" -> "- [##?] Multi prompt"
- ok   typed "[##] Multi option" -> "- [##] Multi option"
- ok   typed "[|] Compact switch" -> "- [|x] Compact switch"
- ok   typed "[True|False] Labeled switch" -> "- [True|x False] Labeled switch"
- ok   typed "[:blue|:green] Color-only switch" -> "- [:blue|x :green] Color-only switch"
- click open task box: "- [x] Open task"
- click labeled result False: "- [True][x False] Labeled result"
- click colored result Draw: "- [True:green][x Draw:yellow][False:red] Colored result"
- click pass/fail right X: "- [ ][x] Pass or fail result"
- click single choice: "- [#x] Single choice"
- click multi option: "- [##x] Multi option"
- click compact switch: "- [x|] Compact switch"
- mermaid workspace buttons: View · Code · − · + · Fit · More · Close
- ok   Visual mode absent (View/Code only)
