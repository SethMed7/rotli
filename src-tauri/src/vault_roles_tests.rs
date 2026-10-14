use super::*;
use tempfile::TempDir;

fn marker(root: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(root.join(MARKER)).unwrap()).unwrap()
}

#[test]
fn a_fresh_copy_is_marked_imported_once_with_its_role_map() {
    let dir = TempDir::new().unwrap();
    assert_eq!(mark_imported(dir.path()).unwrap(), Marked::Imported);
    let written = marker(dir.path());
    assert!(written["id"].as_str().unwrap().starts_with("mx_"));
    assert_eq!(written["contract"], crate::memex::CONTRACT_VERSION);
    assert_eq!(written["layout"], "imported");
    assert_eq!(written["folders"]["archive"], "Archive (Rotli)");
    assert_eq!(read(dir.path()), Some(FolderRoles::imported()));
    assert_eq!(chats_dir(dir.path()), "chats (Rotli)");

    // written once: a second pass finds Rotli's marker and keeps it byte-for-byte
    let before = fs::read(dir.path().join(MARKER)).unwrap();
    assert_eq!(mark_imported(dir.path()).unwrap(), Marked::AlreadyRotli);
    assert_eq!(fs::read(dir.path().join(MARKER)).unwrap(), before);
}

#[test]
fn a_copied_rotli_vault_stays_a_rotli_vault() {
    let dir = TempDir::new().unwrap();
    let original = "{\"id\":\"mx_existing\",\"contract\":\"3.8\"}\n";
    fs::write(dir.path().join(MARKER), original).unwrap();
    assert_eq!(mark_imported(dir.path()).unwrap(), Marked::AlreadyRotli);
    assert_eq!(fs::read_to_string(dir.path().join(MARKER)).unwrap(), original);
    assert_eq!(read(dir.path()), None, "no role map: the Rotli layout");
    assert_eq!(chats_dir(dir.path()), "chats");
}

#[test]
fn a_foreign_memex_json_is_never_overwritten() {
    let dir = TempDir::new().unwrap();
    let foreign = "{\"name\":\"another tool\"}";
    fs::write(dir.path().join(MARKER), foreign).unwrap();
    assert_eq!(mark_imported(dir.path()).unwrap(), Marked::Foreign);
    assert_eq!(fs::read_to_string(dir.path().join(MARKER)).unwrap(), foreign);
    assert_eq!(read(dir.path()), None);
}

#[test]
fn a_hand_edited_role_map_never_points_a_role_at_the_persons_folder_or_outside() {
    let dir = TempDir::new().unwrap();
    let write = |folders: Value| {
        let body = serde_json::json!({"id": "mx_x", "layout": "imported", "folders": folders});
        fs::write(dir.path().join(MARKER), body.to_string()).unwrap();
    };
    // unusable entries fall back per role
    write(serde_json::json!({"archive": "../out", "trash": ".hidden", "chats": "a/b", "storage": "", "inbox": "In:box"}));
    assert_eq!(read(dir.path()), Some(FolderRoles::imported()));
    // a usable custom name is honoured
    write(serde_json::json!({"inbox": "Capture", "trash": "Trash (Rotli) 2"}));
    assert_eq!(read(dir.path()).unwrap().inbox, "Capture");
    assert_eq!(read(dir.path()).unwrap().trash, "Trash (Rotli) 2");
    // a sink must be a folder Rotli made: never the person's Trash/
    write(serde_json::json!({"trash": "Trash", "archive": "Archive"}));
    assert_eq!(read(dir.path()), Some(FolderRoles::imported()));
    // two roles sharing a folder: the whole map falls back
    write(serde_json::json!({"archive": "Bin (Rotli)", "trash": "bin (Rotli)"}));
    assert_eq!(read(dir.path()), Some(FolderRoles::imported()));
    // no map at all still surfaces the tree with Rotli's suffixed folders
    write(Value::Null);
    assert_eq!(read(dir.path()), Some(FolderRoles::imported()));
}

#[test]
fn interning_hands_back_one_map_per_shape() {
    let a = intern(FolderRoles::imported());
    let b = intern(FolderRoles::imported());
    assert!(std::ptr::eq(a, b));
}

#[test]
fn the_librarian_is_seeded_on_at_suggest_over_carried_settings_and_nothing_else_changes() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join(".rotli")).unwrap();
    fs::write(
        dir.path().join(".rotli/settings.json"),
        "{\"organizerTrust\":\"organize\",\"brainEnabled\":false,\"theme\":\"grove\"}",
    )
    .unwrap();
    seed_librarian(dir.path()).unwrap();
    let settings: Value =
        serde_json::from_str(&fs::read_to_string(dir.path().join(".rotli/settings.json")).unwrap()).unwrap();
    assert_eq!(settings["organizerTrust"], "suggest");
    assert_eq!(settings["brainEnabled"], true, "the switch is this vault's, not carried");
    assert_eq!(settings["theme"], "grove");

    let fresh = TempDir::new().unwrap();
    seed_librarian(fresh.path()).unwrap();
    let settings: Value =
        serde_json::from_str(&fs::read_to_string(fresh.path().join(".rotli/settings.json")).unwrap()).unwrap();
    assert_eq!(settings, serde_json::json!({"brainEnabled": true, "organizerTrust": "suggest"}));
}

#[test]
fn rotlis_folders_never_take_a_name_the_person_already_uses() {
    let dir = TempDir::new().unwrap();
    for taken in ["Trash (Rotli)", "trash (rotli) 2", "chats (Rotli)", "Inbox"] {
        fs::create_dir_all(dir.path().join(taken)).unwrap();
    }
    mark_imported(dir.path()).unwrap();
    let roles = read(dir.path()).unwrap();
    assert_eq!(roles.trash, "Trash (Rotli) 3");
    assert_eq!(roles.chats, "chats (Rotli) 2");
    assert_eq!(roles.archive, "Archive (Rotli)");
    assert_eq!(roles.inbox, "Inbox", "a copied Inbox is used as it");
}
