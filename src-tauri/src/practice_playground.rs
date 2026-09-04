//! Markdown-only lessons installed by the explicit Practice Vault flow.
//! Keeping the tutorial at this seam leaves the core memex scaffold small and
//! ensures ordinary vault creation never acquires sample content.

use std::fs;
use std::path::Path;

use crate::memex::{scaffold_memex, WELCOME_PRESET_FILE};

const VERSION: u32 = 1;
const DIR: &str = "wiki/Playground";

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
    write(
        &playground.join("00 Start Here.md"),
        &format!(
            r#"# Playground — Start Here

Playground edition {VERSION}. Everything in this folder is ordinary Markdown. Copy the whole `Playground` folder into another vault whenever you want these examples nearby.

## How to use it

1. Open each lesson from Library → Playground.
2. Click the rendered controls, then switch **Aa → Raw markdown** to see the source change.
3. Edit freely. Delete this folder when you are done.

- [[Playground — Tasks and progress]]
- [[Playground — Choices and toggles]]
- [[Playground — Literal syntax]]
"#,
        ),
    )?;
    write(
        &playground.join("01 Tasks and progress.md"),
        r#"# Playground — Tasks and progress

Type `[]`, `[/]`, or `[x]` and press Space at the start of a line. Rotli adds the portable list marker.

- [ ] Not started
- [/] In progress
- [x] Done

The single task uses your theme accent. Green and red stay reserved for pass/fail results:

- [ ][ ] Did the check pass?
- [True][False] Is the decision binary?
- [True:green][Draw:yellow][False:red] What was the outcome?
"#,
    )?;
    write(
        &playground.join("02 Choices and toggles.md"),
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
"#,
    )?;
    write(
        &playground.join("03 Literal syntax.md"),
        r#"# Playground — Literal syntax

Backticks keep examples literal in beautified notes. The backticks disappear, while the source characters stay visible as code text.

- `[#]` creates a single-choice row only when typed outside backticks and followed by Space.
- `[##]` creates a multi-choice row.
- `[True|False]` creates a labeled switch.
- `[True:green][Draw:#E3B341][False:red]` creates colored result buttons.

Custom colors accept strict three- or six-digit hex. Invalid colors remain ordinary Markdown instead of becoming a half-working control.
"#,
    )?;

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
        let literal = fs::read_to_string(playground.join("03 Literal syntax.md")).unwrap();
        assert!(literal.contains("`[#]`"));
        let welcome = fs::read_to_string(root.join(WELCOME_PRESET_FILE)).unwrap();
        assert!(welcome.contains("[[Playground — Start Here]]"));
        assert!(scaffold_practice_vault(&root).is_err());
    }
}
