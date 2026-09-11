//! The headless CLI's help text (`rotli help`). Kept beside the dispatcher in
//! `workspace.rs`; edit both when a command is added or gated.
pub(crate) const CLI_HELP: &str = r#"Rotli headless workspace (JSON output)

rotli roots
rotli rename "CURRENT TITLE OR ID" "NEW TITLE" [--root ID]
rotli notes list [--root ID] [--limit N]
rotli notes search QUERY [--root ID] [--limit N]
rotli notes query 'EXPRESSION' [--root ID] [--limit N]
rotli notes read ID [--root ID]
rotli notes create --title TITLE [--body TEXT|--body-file PATH|--stdin] [--main main:FOLDER] [--view NAME]
rotli notes update ID --revision REV [--body TEXT|--body-file PATH|--stdin]
rotli notes patch ID --revision REV --old EXACT_TEXT --new REPLACEMENT
rotli notes move ID --folder PATH
rotli folders list [--root ID]
rotli folders create --name NAME [--parent main:FOLDER]          # Main folder
rotli folders create --disk --name NAME [--parent PATH]         # physical folder, policy-gated
rotli main list|add|move|remove|create-folder ...
rotli views list|create|rename|delete|assign|unassign|create-folder ...
rotli boards list|read|create|update|apply ...
rotli open ID [--kind note|board|file]
rotli agent doctor [--root ID]                                  # read-only boundary + metrics
rotli agent config                                              # local + remote MCP setup
rotli agent self-test                                           # disposable end-to-end validation
rotli mcp                                                        # stdio MCP server
rotli mcp --http 127.0.0.1:43110 --token TOKEN                   # authenticated loopback HTTP
rotli mcp config                                                 # Claude/Codex config snippets

Note bodies are text/markdown without YAML frontmatter; Rotli owns frontmatter.
Every update requires the revision returned by read. Notes created in a Rotli vault
land in wiki/_inbox and are referenced from Main immediately.

Read/create/query/board results include a clickable deepLink
(rotli://open?id=...&kind=note|board|file) that surfaces the item in the app;
`rotli open` returns the same link. Print it so humans can jump to the item.
Items in connected (non-default) roots carry no deepLink — the open lane
serves the default workspace only."#;
