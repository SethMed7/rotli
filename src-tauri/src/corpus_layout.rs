// How a corpus root is shaped (Layout), what each path is to Rotli there
// (Surface), and where Rotli's own folders are. Rotli vaults and legacy roots
// keep their fixed names; an imported vault reads Rotli's folders from its
// role map (vault_roles.rs). Split from corpus.rs.

use super::*;
use crate::vault_roles::FolderRoles;

/// The folder a note is PROJECTED into. In a Memex, a `wiki/` note appears under
/// its PRIMARY shelf (the user's view) when one is set; otherwise it falls back to
/// its disk folder (a curated note with no shelf yet stays where it lives on disk).
/// Everything outside a memex's wiki/, and the whole local corpus, is unaffected.
pub(crate) fn project_folder(layout: Layout, disk_folder: &str, fm: &Frontmatter) -> String {
    if layout == Layout::Memex {
        let lifecycle_folder = project_lifecycle_folder(layout, disk_folder);
        if lifecycle_folder != disk_folder {
            return lifecycle_folder;
        }
        // storage/ binaries surface under the reserved "Storage" destination
        if disk_folder == "storage" || disk_folder.starts_with("storage/") {
            return "Storage".to_string();
        }
        if disk_folder == "wiki/_secure" || disk_folder.starts_with("wiki/_secure/") {
            let shelves = shelf_of(fm);
            // A quick capture is secure at birth, so it lives in wiki/_secure —
            // but its shelf is still the capture shelf "Inbox". It is a CAPTURE,
            // not a full note: project it to the reserved "Board" root the
            // sidebar reads as "Captures", exactly like a staged wiki/_inbox
            // capture, instead of filing it under "Secure notes" beside every
            // curated secure note (2026-09-01: "quick captures are not full
            // notes — they are separate"). Protection is unchanged: the file
            // stays in the gitignored secure spine and model-gated on read.
            if shelves.first().is_some_and(|shelf| shelf == "Inbox") {
                return "Board".to_string();
            }
            return shelves
                .into_iter()
                .find(|shelf| shelf == "Secure notes" || shelf.starts_with("Secure notes/"))
                .unwrap_or_else(|| "Secure notes".to_string());
        }
        if disk_folder == "wiki" || disk_folder.starts_with("wiki/") {
            if let Some(primary) = shelf_of(fm).into_iter().next() {
                // the default capture shelf "Inbox" is the ONE Captures surface — route
                // it to the reserved "Board" root the sidebar reads as "Captures" (the maintainer,
                // 2026-06-30); a real user shelf (Northstar/Payments) still projects to it.
                return if primary == "Inbox" {
                    "Board".to_string()
                } else {
                    primary
                };
            }
        }
    }
    // An imported vault's ids are its disk paths. The one projection is a
    // capture: a note in the inbox still on the capture shelf reads under the
    // reserved "Board" root, as in a Rotli vault (decision D).
    if let Layout::Imported(roles) = layout {
        if disk_folder == roles.inbox && shelf_of(fm).first().is_some_and(|shelf| shelf == "Inbox") {
            return "Board".to_string();
        }
    }
    disk_folder.to_string()
}

/// Memex lifecycle folders are conventional lowercase disk structure while the
/// workspace presents stable title-case destination labels.
pub(crate) fn project_lifecycle_folder(layout: Layout, disk_folder: &str) -> String {
    if layout != Layout::Memex {
        return disk_folder.to_string();
    }
    if disk_folder == "archive" || disk_folder.starts_with("archive/") {
        return format!("Archive{}", &disk_folder["archive".len()..]);
    }
    if disk_folder == "trash" || disk_folder.starts_with("trash/") {
        return format!("Trash{}", &disk_folder["trash".len()..]);
    }
    disk_folder.to_string()
}

pub(crate) fn lifecycle_disk_folder(layout: Layout, folder: &str) -> String {
    if layout != Layout::Memex {
        return folder.to_string();
    }
    if folder == "Archive" || folder.starts_with("Archive/") {
        return format!("archive{}", &folder["Archive".len()..]);
    }
    if folder == "Trash" || folder.starts_with("Trash/") {
        return format!("trash{}", &folder["Trash".len()..]);
    }
    folder.to_string()
}


/// Trash and its subtree only — the ONE root search never surfaces (Archive
/// stays findable; restore is what resurrects Trash).
pub(crate) fn is_trash_folder(layout: Layout, folder: &str) -> bool {
    under(folder, layout.trash_id())
}

/// A chat transcript's folder — the Chat front (All chats) owns that domain;
/// transcripts never ride note search or note listings. Vault layouts only:
/// in a plain (LegacyRotli) root there is no Chat front, so a user folder
/// that happens to be named "chats" is just a folder. In an imported vault the
/// person's own `chats/` is theirs; Rotli's is the role map's.
pub(crate) fn is_chats_lane(layout: Layout, folder: &str) -> bool {
    match layout {
        Layout::Memex => under(folder, "chats"),
        Layout::Imported(roles) => under(folder, &roles.chats),
        Layout::LegacyRotli => false,
    }
}

/// Archive and its subtree — excluded from the Tasks projection (a task in a
/// sink is not a nag; restore is what resurrects it).
pub(crate) fn is_archive_folder(layout: Layout, folder: &str) -> bool {
    under(folder, layout.archive_id())
}



/// How the corpus root is shaped — decided once at `open()` by probing
/// `root/memex.json` for a valid `mx_` id.
///   • `LegacyRotli` — today's `~/Documents/rotli`: reserved folders, first-run,
///     everything writable. BYTE-IDENTICAL to before Increment 3.
///   • `Memex` — the root IS someone's memex spine (for the maintainer, `~/memex-vault`).
///     `chats/` and `wiki/` are writable + surfaced read-write; `identity/`,
///     `personality/`, `history/`, `MAP.md`, `inbox.md` stay out of the tree (Reference)
///     and every control file stays HIDDEN. No reserved folders are scaffolded, no
///     first-run seeding ever runs.
///   • `Imported` — a copy of someone's notes folder Rotli made into a vault
///     (`"layout": "imported"` in the marker, vault_roles.rs). Every top-level
///     folder is the person's and surfaced; Rotli's own folders are the role
///     map's, so a copied `Archive/` is never read as Rotli's archive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    Memex,
    LegacyRotli,
    Imported(&'static FolderRoles),
}

impl Layout {
    /// The layout of a root whose marker is a valid `mx_` id.
    pub(crate) fn of_vault(root: &Path) -> Self {
        crate::vault_roles::read(root)
            .map(|roles| Layout::Imported(crate::vault_roles::intern(roles)))
            .unwrap_or(Layout::Memex)
    }

    pub(crate) fn roles(self) -> Option<&'static FolderRoles> {
        match self {
            Layout::Imported(roles) => Some(roles),
            _ => None,
        }
    }

    pub(crate) fn is_imported(self) -> bool {
        self.roles().is_some()
    }

    /// Rotli's archive sink, as a folder id.
    pub(crate) fn archive_id(self) -> &'static str {
        self.roles().map_or("Archive", |roles| roles.archive.as_str())
    }

    /// Rotli's trash sink, as a folder id.
    pub(crate) fn trash_id(self) -> &'static str {
        self.roles().map_or("Trash", |roles| roles.trash.as_str())
    }

    /// Where Rotli keeps binaries it imports or makes.
    pub(crate) fn storage_dir(self) -> &'static str {
        match self {
            Layout::Memex => "storage",
            Layout::Imported(roles) => &roles.storage,
            Layout::LegacyRotli => "Storage",
        }
    }

    /// Where new notes land when no folder is asked for.
    pub(crate) fn intake_dir(self) -> &'static str {
        match self {
            Layout::Memex => "wiki/_inbox",
            Layout::Imported(roles) => &roles.inbox,
            Layout::LegacyRotli => "Inbox",
        }
    }

    /// The writable board lane inside the storage folder (vault layouts).
    pub(crate) fn board_lane(self) -> String {
        match self {
            Layout::Memex => BOARD_LANE.to_string(),
            Layout::Imported(roles) => format!("{}/excalidraw", roles.storage),
            Layout::LegacyRotli => "Board".to_string(),
        }
    }
}

/// `folder` is `root` or lives beneath it.
fn under(folder: &str, root: &str) -> bool {
    folder == root || folder.strip_prefix(root).is_some_and(|rest| rest.starts_with('/'))
}

/// Whether `root/memex.json` marks this dir as a real memex (valid `mx_` id).
/// Pure (no app handle) so `open()` and the unit tests can both call it. The
/// detection IDEA mirrors `memex::detect_one`; this is a tiny local probe so
/// corpus.rs never depends on the memex module's wire types.
pub fn is_memex_root(root: &Path) -> bool {
    let text = match fs::read_to_string(root.join("memex.json")) {
        Ok(t) => t,
        Err(_) => return false,
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("id").and_then(|x| x.as_str()).map(str::to_string))
        .map(|id| id.starts_with("mx_"))
        .unwrap_or(false)
}

/// What a relative path is to rotli, given the layout. The Notes tree (walk/list)
/// uses it to decide inclusion + read/write flags; the write gate uses it to
/// refuse forbidden paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    /// A normal, editable note (LegacyRotli: everything; Memex: `wiki/**.md` +
    /// `chats/**.md`).
    NoteRW,
    /// Surfaced but read-only (Memex: `storage/**` foreign binaries).
    NoteRO,
    /// The brain's MEMORY lanes (Memex: identity/ personality/ history/ MAP.md
    /// inbox.md). NOT in the user's Notes tree and never writable by any lane —
    /// but RETRIEVABLE by the AI's own tools (search / knowledge map / read),
    /// for BOTH model classes (the maintainer, 2026-08-01: "it shouldn't be invisible").
    /// See docs/design/ai-visibility-matrix.md.
    Reference,
    /// Never surfaced, never written, never retrievable (Memex: memex.json,
    /// users.json, STRUCTURE/CONFIG/README docs, clients/, scripts/, …).
    Hidden,
}

/// The scope predicate. `rel` is a path relative to the corpus root, using `/`
/// separators ("" = the root itself).
///
/// LegacyRotli surfaces everything read-write (today's behavior). Memex surfaces
/// `wiki/`, `chats/`, and the exact welcome preset path as read-write in the
/// Notes tree, marks the
/// brain's memory (identity/personality/history/MAP/inbox) `Reference` — out of
/// the tree but reachable by the AI's retrieval tools — and hides every
/// memex-vault control file. Top-level memex-vault docs (STRUCTURE.md,
/// CONFIG.md, …) are `.md`, so this rule — not the dot-filter — is what keeps
/// them out of the Notes tree.
pub(crate) fn surfaced(layout: Layout, rel: &str) -> Surface {
    if layout == Layout::LegacyRotli {
        return Surface::NoteRW;
    }
    let rel = rel.trim_start_matches('/');
    if let Layout::Imported(roles) = layout {
        return surfaced_imported(roles, rel);
    }
    // A newly scaffolded vault owns one real, editable root-level Markdown
    // note. It is deliberately outside wiki/ (and therefore Library), while
    // every other root document remains hidden/control material.
    if rel == crate::memex::WELCOME_PRESET_FILE {
        return Surface::NoteRW;
    }
    // chats/ — rotli's owned, writable surface (the dir itself + everything under)
    if rel == "chats" || rel.starts_with("chats/") {
        return Surface::NoteRW;
    }
    // wiki/ — the brain's knowledge tree, WRITABLE (2026-08-03). The read-only
    // era ("this increment") ended when the Librarian began filing staged notes
    // into curated areas: a note the filer organizes must stay editable, not
    // silently become read-only the moment it leaves wiki/_inbox (the save
    // banner retried forever). This covers _inbox staging and _secure alike;
    // _secure stays model-gated on READ and never an organizer area, and the
    // organizer still skips secure + locked notes.
    if rel == "wiki" || rel.starts_with("wiki/") {
        return Surface::NoteRW;
    }
    // Archive/ + Trash/ — rotli's LIFECYCLE sinks (capitalized, matching the TS
    // destinations + is_hidden_root). A note the user archives/trashes lands in
    // these rotli-owned dirs at the memex root; they're never the curated
    // knowledge, so lifecycle moves are a sanctioned write lane even in a memex.
    // Without this, archive/trash silently no-op in a memex (the maintainer, 2026-07-07).
    if is_hidden_root(layout, rel) {
        return Surface::NoteRW;
    }
    // storage/excalidraw/ — the memex's BOARD lane (the maintainer, 2026-07-07). Excalidraw
    // scenes rotli creates + edits live here, so they're WRITABLE even though the
    // rest of storage/ (foreign binary drops) stays read-only below. Must precede
    // the storage/ rule. A board is rotli's own content, not a foreign asset.
    if rel == "storage/excalidraw" || rel.starts_with("storage/excalidraw/") {
        return Surface::NoteRW;
    }
    // storage/ — the memex's gitignored binary asset store; surfaced READ-ONLY so
    // the Storage front shows your files (projected to the Storage destination,
    // opened in the OS default app). NEVER written via the note path (is_writable
    // refuses it); binaries are written by the storage/ drop command instead.
    if rel == "storage" || rel.starts_with("storage/") {
        return Surface::NoteRO;
    }
    // The brain's MEMORY lanes: out of the Notes tree, unwritable — but the AI
    // may retrieve them (the maintainer, 2026-08-01). Directories are matched with their
    // trailing slash so a sibling like "identity-notes/" never rides this rule.
    if is_reference_lane(rel) {
        return Surface::Reference;
    }
    // everything else inside a memex is hidden from BOTH the Notes tree and the
    // AI, and is unwritable: every control file (memex.json, users.json,
    // *.local.json, *.json at root, clients/, scripts/,
    // STRUCTURE/CONFIG/README/CHANGELOG/ASSETS/GUIDE/QUERY .md, …).
    Surface::Hidden
}

/// The memex lanes that hold the user's own KNOWLEDGE outside `wiki/` — the
/// whole-person identity layer, the AI's working model of them, the by-day
/// conversation stream, the always-loaded index, and the capture zone. Named
/// once so the surface predicate and the docs agree. Vault plumbing
/// (memex.json, STRUCTURE.md, scripts/, clients/, …) is deliberately NOT here.
pub(crate) fn is_reference_lane(rel: &str) -> bool {
    const DIRS: [&str; 3] = ["identity", "personality", "history"];
    const FILES: [&str; 2] = ["MAP.md", "inbox.md"];
    DIRS.iter()
        .any(|d| rel == *d || rel.starts_with(&format!("{d}/")))
        || FILES.contains(&rel)
}


/// The two never-delete sinks: a folder is a hidden root when it IS Archive or
/// Trash, or lives anywhere beneath one. Moving INTO one stamps an origin;
/// moving back OUT clears it. (the maintainer, 2026-06-13)
pub(crate) fn is_hidden_root(layout: Layout, folder: &str) -> bool {
    if let Layout::Imported(roles) = layout {
        return under(folder, &roles.archive) || under(folder, &roles.trash);
    }
    folder == "Archive"
        || folder == "Trash"
        || folder == "archive"
        || folder == "trash"
        || folder.starts_with("Archive/")
        || folder.starts_with("Trash/")
        || folder.starts_with("archive/")
        || folder.starts_with("trash/")
}


/// An imported vault: the person's whole tree is theirs and editable. Rotli's
/// storage folder keeps a Rotli vault's rules (binaries read-only, boards
/// writable), and the vault's own root marker files stay hidden.
fn surfaced_imported(roles: &FolderRoles, rel: &str) -> Surface {
    const CONTROL: [&str; 4] = ["memex.json", "users.json", "memex.local.json", "identities.local.json"];
    if CONTROL.contains(&rel) {
        return Surface::Hidden;
    }
    if under(rel, &format!("{}/excalidraw", roles.storage)) {
        return Surface::NoteRW;
    }
    if under(rel, &roles.storage) {
        return Surface::NoteRO;
    }
    Surface::NoteRW
}

#[cfg(test)]
#[path = "corpus_layout_tests.rs"]
mod tests;
