//! An imported vault: a copy of someone's existing notes folder (Obsidian,
//! ZenNotes, plain Markdown) that Rotli made and now treats as a Rotli vault
//! (docs/design/vault-copy-and-obsidian-compatibility.md, slice 4).
//!
//! Its root marker (`memex.json`, contract 3.9) says `"layout": "imported"` and
//! carries a role map naming Rotli's own folders. The map is written once, when
//! the copy is made, and read on every open. The person's top-level folders are
//! theirs (owner decision F, 2026-10-14): a copied `Archive/`, `Trash/`,
//! `chats/`, or `storage/` is an ordinary folder, so Rotli's folders are always
//! suffixed — one code path, never "only on a clash". New notes and captures
//! land in a top-level `Inbox/` (decision D); a copied `Inbox/` is used as it.
//!
//! The signal lives in the marker, not in `.rotli/`, because `.rotli/` is
//! rebuildable.

use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;

const MARKER: &str = "memex.json";
pub(crate) const LAYOUT_IMPORTED: &str = "imported";

/// Rotli's own folders in an imported vault, by role. Each is one top-level
/// folder name; ids in an imported vault are disk paths, so these are also
/// the folder ids the webview sees (`FolderRoles` in src/services/destinations.ts).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderRoles {
    pub(crate) inbox: String,
    pub(crate) archive: String,
    pub(crate) trash: String,
    pub(crate) chats: String,
    pub(crate) storage: String,
}

impl FolderRoles {
    /// The map every import writes — byte-identical to IMPORTED_FOLDER_ROLES in
    /// src/services/destinations.ts (parity.json).
    pub(crate) fn imported() -> Self {
        Self {
            inbox: "Inbox".into(),
            archive: "Archive (Rotli)".into(),
            trash: "Trash (Rotli)".into(),
            chats: "chats (Rotli)".into(),
            storage: "storage (Rotli)".into(),
        }
    }

    /// A map read from disk. A missing or unusable entry falls back to the
    /// imported default for that role, so a hand-edited marker can never make
    /// Rotli treat the person's own `Archive/` as its archive, or point a role
    /// outside the vault's top level.
    fn from_marker(folders: Option<&Value>) -> Self {
        let defaults = Self::imported();
        // a sink, chat, or storage role must name a folder Rotli made (always
        // suffixed): a hand edit can never turn the person's `Trash/` into
        // Rotli's trash, which Empty Trash may purge
        let pick = |key: &str, fallback: String| {
            folders
                .and_then(|map| map.get(key))
                .and_then(Value::as_str)
                .filter(|name| usable_name(name))
                .filter(|name| key == "inbox" || name.contains("(Rotli)"))
                .map(str::to_string)
                .unwrap_or(fallback)
        };
        let roles = Self {
            inbox: pick("inbox", defaults.inbox.clone()),
            archive: pick("archive", defaults.archive.clone()),
            trash: pick("trash", defaults.trash.clone()),
            chats: pick("chats", defaults.chats.clone()),
            storage: pick("storage", defaults.storage.clone()),
        };
        // two roles sharing one folder would make a trashed note read as
        // archived, or a chat as a capture: refuse the whole map instead
        let names = [&roles.inbox, &roles.archive, &roles.trash, &roles.chats, &roles.storage];
        let distinct = names
            .iter()
            .enumerate()
            .all(|(i, a)| names[i + 1..].iter().all(|b| !a.eq_ignore_ascii_case(b)));
        if distinct {
            roles
        } else {
            defaults
        }
    }

    /// The map for a copy at `root`: Rotli's own folders take the next free
    /// name (`Trash (Rotli) 2`, …) when the person already has one by that
    /// name, so nothing they brought is ever read as Rotli's. The inbox is
    /// the exception: a copied `Inbox/` is used as it (decision D).
    fn free_in(root: &Path) -> Self {
        let taken: Vec<String> = fs::read_dir(root)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().to_lowercase())
                    .collect()
            })
            .unwrap_or_default();
        let free = |base: String| {
            (1..)
                .map(|n| if n == 1 { base.clone() } else { format!("{base} {n}") })
                .find(|name| !taken.contains(&name.to_lowercase()))
                .unwrap_or(base.clone())
        };
        let defaults = Self::imported();
        Self {
            inbox: defaults.inbox,
            archive: free(defaults.archive),
            trash: free(defaults.trash),
            chats: free(defaults.chats),
            storage: free(defaults.storage),
        }
    }

    fn to_json(&self) -> Value {
        serde_json::json!({
            "inbox": self.inbox,
            "archive": self.archive,
            "trash": self.trash,
            "chats": self.chats,
            "storage": self.storage,
        })
    }
}

/// One top-level folder name: no separators, no root-id colon, no dot-entry,
/// nothing Rotli's own control files use.
fn usable_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name.trim() == name
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':'])
        && name != ".."
        && !name.eq_ignore_ascii_case(MARKER)
}

fn read_marker(root: &Path) -> Option<Value> {
    let text = fs::read_to_string(root.join(MARKER)).ok()?;
    let value = serde_json::from_str::<Value>(&text).ok()?;
    let id = value.get("id").and_then(Value::as_str)?;
    id.starts_with("mx_").then_some(value)
}

/// The role map when `root` is an imported vault (an `mx_` marker that says
/// `"layout": "imported"`); `None` for a Rotli vault, a legacy folder, or a
/// foreign `memex.json`.
pub(crate) fn read(root: &Path) -> Option<FolderRoles> {
    let marker = read_marker(root)?;
    (marker.get("layout").and_then(Value::as_str) == Some(LAYOUT_IMPORTED))
        .then(|| FolderRoles::from_marker(marker.get("folders")))
}

/// The same map, interned so `Layout` can stay `Copy`. Distinct maps are few
/// (one per imported vault, in practice one shape), so the set stays tiny.
pub(crate) fn intern(roles: FolderRoles) -> &'static FolderRoles {
    static SEEN: OnceLock<Mutex<Vec<&'static FolderRoles>>> = OnceLock::new();
    let mut seen = SEEN
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(known) = seen.iter().find(|known| ***known == roles) {
        return known;
    }
    let leaked: &'static FolderRoles = Box::leak(Box::new(roles));
    seen.push(leaked);
    leaked
}

/// The folder a vault's chat transcripts live in: the role map's in an
/// imported vault, `chats` in a Rotli vault.
pub(crate) fn chats_dir(root: &Path) -> String {
    read(root).map(|roles| roles.chats).unwrap_or_else(|| "chats".into())
}

/// What `mark_imported` found at the copy's root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Marked {
    /// No marker: the copy is now an imported Rotli vault.
    Imported,
    /// The source was already a Rotli vault (`mx_` marker): it stays one.
    AlreadyRotli,
    /// A `memex.json` that is not Rotli's: never overwritten, so the copy
    /// opens protected, in place.
    Foreign,
}

/// Make a fresh copy an imported Rotli vault: a new `mx_` marker with
/// `"layout": "imported"` and the role map, written once. Never replaces a
/// root `memex.json` — a copied Rotli vault keeps its own marker and layout,
/// and another tool's file is left exactly as copied.
pub(crate) fn mark_imported(root: &Path) -> Result<Marked, String> {
    let path = root.join(MARKER);
    match fs::symlink_metadata(&path) {
        Ok(_) if read_marker(root).is_some() => return Ok(Marked::AlreadyRotli),
        Ok(_) => return Ok(Marked::Foreign),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("read {MARKER}: {e}")),
    }
    let mut extra = serde_json::Map::new();
    extra.insert("layout".into(), LAYOUT_IMPORTED.into());
    extra.insert("folders".into(), FolderRoles::free_in(root).to_json());
    crate::memex::write_new_marker(root, extra)?;
    Ok(Marked::Imported)
}

/// Seed the copy's first Librarian setting at Suggest (nothing moves without
/// the person) — every other setting carried from the previous vault, the
/// Librarian switch included, stays as it is.
pub(crate) fn seed_suggest(root: &Path) -> Result<(), String> {
    let dir = root.join(".rotli");
    let path = dir.join("settings.json");
    let mut settings = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .map_err(|e| format!("read the copy's settings: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(format!("read the copy's settings: {e}")),
    };
    let Some(object) = settings.as_object_mut() else {
        return Err("the copy's settings are not an object".into());
    };
    object.insert("organizerTrust".into(), Value::String("suggest".into()));
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n";
    crate::fsutil::atomic_write(&path, &text, ".rotli-settings-")
}

#[cfg(test)]
#[path = "vault_roles_tests.rs"]
mod tests;
