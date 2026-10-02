//! The headless CLI's help text (`rotli help`) and the copy-ready MCP client
//! setups (`rotli agent config`). Kept beside the dispatcher in
//! `workspace.rs`; edit both when a command is added or gated.

use serde_json::{json, Value};
pub(crate) const CLI_HELP: &str = r#"Rotli headless workspace (JSON output)

rotli roots
rotli rename "CURRENT TITLE OR ID" "NEW TITLE" [--revision REV] [--root ID]
rotli notes list [--root ID] [--limit N]
rotli notes search QUERY [--root ID] [--limit N]
rotli notes query 'EXPRESSION' [--root ID] [--limit N]
rotli notes read ID [--root ID]
rotli notes create --title TITLE [--body TEXT|--body-file PATH|--stdin] [--main main:FOLDER] [--view NAME]
rotli notes update ID --revision REV [--body TEXT|--body-file PATH|--stdin]
rotli notes patch ID --revision REV --old EXACT_TEXT --new REPLACEMENT
rotli notes move ID --folder PATH
rotli notes attachments ID [--text] [--max-bytes N]            # linked files: path, MIME, size
rotli notes trash ID --revision REV                            # to Rotli's Trash, never deleted
rotli notes history ID [--limit N]                             # journaled AI body edits + diffs
rotli notes undo-ai-edit ID --revision REV                     # only while the note is as it left it
rotli folders list [--root ID]
rotli folders create --name NAME [--parent main:FOLDER]          # Main folder
rotli folders create --disk --name NAME [--parent PATH]         # physical folder, policy-gated
rotli main list|add|move|remove|create-folder ...
rotli views list|create|rename|delete|assign|unassign|create-folder ...
rotli boards list|read|create|update|apply ...
rotli open ID [--kind note|board|file] [--root ID]
rotli agent doctor [--root ID]                                  # read-only boundary + metrics
rotli agent config                                              # Claude/Codex/Cursor/Gemini + remote MCP setup
rotli agent self-test                                           # disposable end-to-end validation
rotli mcp                                                        # stdio MCP server
rotli mcp --http 127.0.0.1:43110 --token TOKEN                   # authenticated loopback HTTP
rotli mcp config                                                 # same as agent config

Note bodies are text/markdown without YAML frontmatter; Rotli owns frontmatter.
Every update requires the revision returned by read. Notes created in a Rotli vault
land in wiki/_inbox and are referenced from Main immediately.

Read/create/query/board results include a clickable deepLink
(rotli://open?id=...&kind=note|board|file) that surfaces the item in the app;
`rotli open` returns the same link. Print it so humans can jump to the item.
Items in connected roots carry their root-prefixed id (ROOT:path) in the link.

Agents edit a note's text only if an AI made it or the person turned on
"Let AI edit"; the same rule governs rename and trash. Every AI body edit is
journaled in .rotli/ai-edit-journal.jsonl (secure notes without their text)."#;


/// Every supported client's setup for the stdio server at `command`. Rotli
/// only PRINTS these; it never edits a client's configuration itself.
pub(crate) fn mcp_setup(command: &str) -> Value {
    let quoted = shell_quote(command);
    // Cursor (`.cursor/mcp.json` or `~/.cursor/mcp.json`) and Gemini CLI
    // (`.gemini/settings.json` or `~/.gemini/settings.json`) both read an
    // `mcpServers` map; Gemini's `trust: false` keeps its per-call confirmation.
    let server = |extra: Value| {
        let mut entry = json!({ "command": command, "args": ["mcp"] });
        if let (Some(entry), Some(extra)) = (entry.as_object_mut(), extra.as_object()) {
            entry.extend(extra.clone());
        }
        json!({ "mcpServers": { "rotli-workspace": entry } })
    };
    json!({
        "server": "rotli-workspace",
        "transport": "stdio",
        "command": command,
        "args": ["mcp"],
        "claudeCode": format!("claude mcp add --transport stdio --scope user rotli-workspace -- {quoted} mcp"),
        "codex": format!("codex mcp add rotli-workspace -- {quoted} mcp"),
        "codexToml": format!("[mcp_servers.rotli-workspace]\ncommand = {command:?}\nargs = [\"mcp\"]\ndefault_tools_approval_mode = \"writes\""),
        "cursor": {
            "file": "~/.cursor/mcp.json (all projects) or .cursor/mcp.json (one project)",
            "json": server(json!({ "type": "stdio" })),
        },
        "gemini": {
            "command": format!("gemini mcp add --scope user rotli-workspace {quoted} mcp"),
            "file": "~/.gemini/settings.json (user) or .gemini/settings.json (project)",
            "json": server(json!({ "trust": false })),
        },
        "remoteHttp": {
            "transport": "streamable-http",
            "mcpUrl": "https://YOUR-RELAY.example/mcp",
            "authorization": "Bearer <client token returned only when Settings creates the pairing>",
            "grokBot": "Tell Grok Bot to add the MCP URL, then provide the static Authorization bearer header. Rotli must be open and explicitly connected for this app session."
        },
        "verify": {
            "rotli": format!("{quoted} agent doctor"),
            "isolatedSelfTest": format!("{quoted} agent self-test"),
            "claude": "claude mcp get rotli-workspace",
            "codex": "codex mcp get rotli-workspace",
            "gemini": "gemini mcp list",
            "cursor": "Cursor Settings > MCP lists rotli-workspace with its tools"
        },
        "boundary": "Rotli prints setup instructions but never edits Claude, Codex, Cursor, or Gemini configuration itself. Use the installed app binary, not a temporary target/debug build."
    })
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_client_setup_names_the_same_server_and_command() {
        let setup = mcp_setup("/Applications/Rotli.app/Contents/MacOS/rotli");
        for client in ["cursor", "gemini"] {
            let entry = &setup[client]["json"]["mcpServers"]["rotli-workspace"];
            assert_eq!(entry["command"], "/Applications/Rotli.app/Contents/MacOS/rotli", "{client}");
            assert_eq!(entry["args"], json!(["mcp"]), "{client}");
        }
        assert_eq!(setup["cursor"]["json"]["mcpServers"]["rotli-workspace"]["type"], "stdio");
        assert_eq!(setup["gemini"]["json"]["mcpServers"]["rotli-workspace"]["trust"], false);
        assert_eq!(
            setup["gemini"]["command"],
            "gemini mcp add --scope user rotli-workspace '/Applications/Rotli.app/Contents/MacOS/rotli' mcp"
        );
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
