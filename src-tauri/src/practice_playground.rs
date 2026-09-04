//! Markdown-only lessons installed by the explicit Practice Vault flow.
//! Keeping the tutorial at this seam leaves the core memex scaffold small and
//! ensures ordinary vault creation never acquires sample content.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::corpus::{
    CorpusState, CorpusStore, NamedView, ReferenceNode, ViewsManifest, DEFAULT_ROOT_ID,
};
use crate::memex::{scaffold_memex, WELCOME_PRESET_FILE};

const VERSION: u32 = 2;
const DIR: &str = "wiki/Playground";
const VIEW_NAME: &str = "Playground";

const LESSONS: [(&str, &str); 4] = [
    (
        "00 Start Here.md",
        r#"# Playground — Start Here

Everything in this view is ordinary Markdown. Edit freely, and delete the Playground view when you are done; the notes remain yours in the vault.

## How to use it

1. Open each lesson from the Playground view.
2. Click the rendered controls, then switch **Aa → Raw markdown** to see the source change.
3. Edit freely. You can remove the view without deleting these notes.

- [[Playground — Tasks and progress]]
- [[Playground — Choices and toggles]]
- [[Playground — Literal syntax]]
"#,
    ),
    (
        "01 Tasks and progress.md",
        r#"# Playground — Tasks and progress

Type `[]`, `[/]`, or `[x]` and press Space at the start of a line. Rotli adds the portable list marker. Enter always starts the next task unchecked.

- [ ] Not started
- [/] In progress
- [x] Done

Arrow left from the start of task text selects the raw state character. On an empty task, type `/` to mark it in progress. You can also linger over an empty checkbox for the In progress action.

The single task uses your theme accent. Green and red stay reserved for pass/fail results:

- [ ][ ] Did the check pass?
- [True][False] Is the decision binary?
- [True:green][Draw:yellow][False:red] What was the outcome?
"#,
    ),
    (
        "02 Choices and toggles.md",
        r#"# Playground — Choices and toggles

`[#]` is one-of-many. Adjacent circles at the same indentation form one group.

- [#] Small
- [#x] Medium
- [#] Large

`[##]` is choose-many. Each square is independent.

- [##x] Email
- [##] SMS
- [##x] In-app

`[|]` is the compact on/off switch. Words on either side of `|` make a labeled switch.

- [|x] Compact switch
- [True:green|x False:red] Labeled switch
- [:blue|:green] Color-only switch
"#,
    ),
    (
        "03 Literal syntax.md",
        r#"# Playground — Literal syntax

Backticks keep examples literal in beautified notes. The backticks disappear, while the source characters stay visible as ordinary text.

- `[#]` creates a single-choice row only when typed outside backticks and followed by Space.
- `[##]` creates a multi-choice row.
- `[True|False]` creates a labeled switch.
- `[True:green][Draw:#E3B341][False:red]` creates colored result buttons.

Named colors include accent, blue, green, yellow, purple, red, and neutral. Custom colors accept strict three- or six-digit hex. Invalid colors remain ordinary Markdown instead of becoming a half-working control.
"#,
    ),
];

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundImport {
    pub imported: bool,
    pub view_name: String,
    pub note_count: usize,
}

fn write(path: &Path, contents: &str) -> Result<(), String> {
    crate::fsutil::atomic_write(path, contents, ".rotli-playground-")
}

pub fn scaffold_practice_vault(root: &Path) -> Result<(), String> {
    scaffold_memex(root)?;
    let playground = root.join(DIR);
    if playground.exists() {
        return Err("the practice playground already exists".into());
    }
    fs::create_dir_all(&playground).map_err(|e| e.to_string())?;
    for (filename, body) in LESSONS {
        let body = if filename == "00 Start Here.md" {
            body.replacen(
                "Everything in this view",
                &format!("Playground edition {VERSION}. Everything in this folder"),
                1,
            )
        } else {
            body.to_string()
        };
        write(&playground.join(filename), &body)?;
    }

    let welcome_path = root.join(WELCOME_PRESET_FILE);
    let welcome = fs::read_to_string(&welcome_path).map_err(|e| e.to_string())?;
    write(
        &welcome_path,
        &format!(
            "{}\n## Practice playground\n\nOpen [[Playground — Start Here]] in Library → Playground for hands-on lessons you can safely edit or delete.\n",
            welcome.trim_end()
        ),
    )
}

/** Install the tutorial into the active vault as ordinary notes plus one
 * named-view projection. Re-importing after the view is deleted reuses intact
 * lessons by exact title and physical folder; user edits are never overwritten. */
pub fn import_playground(store: &mut CorpusStore) -> Result<PlaygroundImport, String> {
    let current: ViewsManifest = serde_json::from_str(&store.views_read()?).unwrap_or_default();
    if current
        .views
        .iter()
        .any(|view| view.name.eq_ignore_ascii_case(VIEW_NAME))
    {
        return Ok(PlaygroundImport {
            imported: false,
            view_name: VIEW_NAME.into(),
            note_count: LESSONS.len(),
        });
    }

    let folder = if store.is_memex() { DIR } else { VIEW_NAME };
    let listed = store.list()?;
    let mut refs = Vec::with_capacity(LESSONS.len());
    for (_, body) in LESSONS {
        let title = crate::corpus::title_of(body);
        let existing = listed
            .notes
            .iter()
            .find(|note| note.disk_folder_id == folder && note.title == title)
            .map(|note| note.id.clone());
        let id = match existing {
            Some(id) => id,
            None => store.create(folder, body)?.id,
        };
        refs.push(ReferenceNode::Note { note: id });
    }

    store.views_update(|raw| {
        let mut manifest: ViewsManifest = serde_json::from_str(raw).unwrap_or_default();
        if !manifest
            .views
            .iter()
            .any(|view| view.name.eq_ignore_ascii_case(VIEW_NAME))
        {
            manifest.views.push(NamedView {
                name: VIEW_NAME.into(),
                tree: refs,
            });
        }
        let contents =
            serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())? + "\n";
        Ok((contents, ()))
    })?;
    Ok(PlaygroundImport {
        imported: true,
        view_name: VIEW_NAME.into(),
        note_count: LESSONS.len(),
    })
}

#[tauri::command]
pub fn corpus_import_playground(
    state: tauri::State<'_, CorpusState>,
) -> Result<PlaygroundImport, String> {
    state.route(DEFAULT_ROOT_ID, import_playground)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn practice_playground_is_a_versioned_importable_markdown_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("practice");
        scaffold_practice_vault(&root).unwrap();

        let playground = root.join(DIR);
        assert_eq!(fs::read_dir(&playground).unwrap().count(), 4);
        let start = fs::read_to_string(playground.join("00 Start Here.md")).unwrap();
        assert!(start.contains(&format!("Playground edition {VERSION}")));
        assert!(start.contains("ordinary Markdown"));
        let controls = fs::read_to_string(playground.join("02 Choices and toggles.md")).unwrap();
        assert!(controls.contains("- [#x] Medium"));
        assert!(controls.contains("- [##x] Email"));
        assert!(controls.contains("- [True:green|x False:red] Labeled switch"));
        assert!(controls.contains("- [:blue|:green] Color-only switch"));
        let literal = fs::read_to_string(playground.join("03 Literal syntax.md")).unwrap();
        assert!(literal.contains("`[#]`"));
        let welcome = fs::read_to_string(root.join(WELCOME_PRESET_FILE)).unwrap();
        assert!(welcome.contains("[[Playground — Start Here]]"));
        assert!(scaffold_practice_vault(&root).is_err());
    }

    #[test]
    fn import_adds_a_deletable_view_and_reuses_lessons_on_reimport() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        scaffold_memex(&root).unwrap();
        let mut store = CorpusStore::open(root).unwrap();

        let first = import_playground(&mut store).unwrap();
        assert_eq!(first.note_count, 4);
        assert!(first.imported);
        let views: ViewsManifest = serde_json::from_str(&store.views_read().unwrap()).unwrap();
        assert_eq!(views.views[0].name, VIEW_NAME);
        assert_eq!(views.views[0].tree.len(), 4);
        let note_count = store.list().unwrap().notes.len();

        store
            .views_update(|_| {
                Ok((
                    serde_json::to_string_pretty(&ViewsManifest::default()).unwrap(),
                    (),
                ))
            })
            .unwrap();
        assert!(import_playground(&mut store).unwrap().imported);
        assert_eq!(store.list().unwrap().notes.len(), note_count);
        assert!(!import_playground(&mut store).unwrap().imported);
    }
}
