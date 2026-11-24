//! The workspace's tag tools (docs/architecture/agent-workspace.md, "Tags"):
//! `rotli tags list|add|remove` and MCP `rotli_list_tags` / `rotli_tag_note`.
//! Agents are remote: the list counts only notes the remote read gate passes,
//! and a change is admitted first (a hidden note answers as a missing one),
//! then held to the AI tag lane's gates in the store (corpus_tags.rs).

use serde::Serialize;
use serde_json::{json, Value};

use super::{arg_required, arg_string, arg_usize, json_value, positional, required_option, usize_option, Workspace};
use crate::corpus::tags::{AiTagger, TagChange};

pub(super) const LIST_TAGS: &str = "rotli_list_tags";
pub(super) const TAG_NOTE: &str = "rotli_tag_note";

pub(super) fn tools(tool: fn(&str, &str, Value, bool) -> Value) -> Vec<Value> {
    let tag_list = json!({"type":"array","maxItems":crate::note_tags::TAGS_PER_CHANGE_MAX,"items":{"type":"string","maxLength":200}});
    vec![
        tool(LIST_TAGS, "List the tags on agent-readable notes, most used first, with how many notes carry each. Secure notes are not counted, and a tag only they carry is not listed. Find a tag's notes with rotli_query tags:NAME.", json!({"type":"object","properties":{"rootId":{"type":"string","maxLength":128},"limit":{"type":"integer","minimum":1,"maximum":500}},"additionalProperties":false}), true),
        tool(TAG_NOTE, "Add or remove tags on one note (its shared `tags:` metadata; the text is untouched). A tag is letters, numbers, -, _ and / (a leading # is dropped), at most 40 characters. Removing matches any case. Only a note an AI made, or one the person granted \"Let AI edit\", may be tagged; secure and locked notes are refused. Requires the revision from the read just before; answers with the note's tags and new revision.", json!({"type":"object","properties":{"id":{"type":"string","maxLength":1024},"add":tag_list,"remove":tag_list,"expectedRevision":{"type":"string","maxLength":128},"rootId":{"type":"string","maxLength":128}},"required":["id","expectedRevision"],"additionalProperties":false}), false),
    ]
}

/// One of these tools' calls, or None when `name` isn't one.
pub(super) fn call(name: &str, args: &Value) -> Option<Result<Value, String>> {
    match name {
        LIST_TAGS => Some((|| {
            let mut workspace = Workspace::open(arg_string(args, "rootId"))?;
            json_value(workspace.list_tags(arg_usize(args, "limit", 200).min(500))?)
        })()),
        TAG_NOTE => Some((|| {
            let strings = |key: &str| -> Vec<String> {
                args.get(key)
                    .and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
                    .unwrap_or_default()
            };
            let change = TagChange { add: strings("add"), remove: strings("remove") };
            let (mut workspace, local) = Workspace::open_for_visible(arg_required(args, "id")?, arg_string(args, "rootId"))?;
            json_value(workspace.tag_note(&local, &change, arg_required(args, "expectedRevision")?)?)
        })()),
        _ => None,
    }
}

/// `rotli tags list | add ID TAG… --revision REV | remove ID TAG… --revision REV`.
pub(super) fn cli(args: &[String], root_id: Option<&str>) -> Result<Value, String> {
    match args.get(1).map(String::as_str).unwrap_or("list") {
        "list" => {
            let mut workspace = Workspace::open(root_id)?;
            json_value(workspace.list_tags(usize_option(args, "--limit", 200)?.min(500))?)
        }
        sub @ ("add" | "remove") => {
            let id = positional(args, 2, &format!("tags {sub} needs a note id"))?;
            let expected = required_option(args, "--revision")?;
            let tags = free_words(&args[3.min(args.len())..]);
            if tags.is_empty() {
                return Err(format!("tags {sub} needs at least one tag"));
            }
            let change = if sub == "add" {
                TagChange { add: tags, remove: Vec::new() }
            } else {
                TagChange { add: Vec::new(), remove: tags }
            };
            let (mut workspace, local) = Workspace::open_for_visible(id, root_id)?;
            json_value(workspace.tag_note(&local, &change, expected)?)
        }
        sub => Err(format!("unknown tags command: {sub}")),
    }
}

/// The words after the id that aren't an option or an option's value.
fn free_words(rest: &[String]) -> Vec<String> {
    let mut words = Vec::new();
    let mut skip = false;
    for word in rest {
        if skip {
            skip = false;
        } else if matches!(word.as_str(), "--revision" | "--root") {
            skip = true;
        } else {
            words.push(word.clone());
        }
    }
    words
}

#[derive(Debug, Serialize)]
pub(super) struct TagListed {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub(super) struct TagList {
    pub count: usize,
    pub tags: Vec<TagListed>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NoteTagged {
    pub id: String,
    pub tags: Vec<String>,
    pub revision: String,
}

impl Workspace {
    /// The tags on notes an agent may read. A tag that names a protected path
    /// is left out, as a query leaves such a value out.
    pub(super) fn list_tags(&mut self, limit: usize) -> Result<TagList, String> {
        let counts = self.store.tag_counts(true)?;
        let mut tags = Vec::new();
        for count in counts {
            if count.tag.contains(['/', '\\']) && self.store.names_protected_path(&count.tag) {
                continue;
            }
            tags.push(TagListed { tag: count.tag, count: count.count });
        }
        tags.truncate(limit.max(1));
        Ok(TagList { count: tags.len(), tags })
    }

    pub(super) fn tag_note(&mut self, local_id: &str, change: &TagChange, expected: &str) -> Result<NoteTagged, String> {
        let tagged = self.store.change_tags_for_ai(local_id, change, AiTagger::Agent, expected)?;
        Ok(NoteTagged { id: self.wire(local_id), tags: tagged.tags, revision: tagged.revision })
    }
}

#[cfg(test)]
#[path = "workspace_tags_tests.rs"]
mod tests;
