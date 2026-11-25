//! Moving a chat file: rename, Trash and Archive. No move ever replaces
//! another chat; each refuses a taken name in the rename itself (chat audit
//! 2026-11-24, D2 and D6).

use std::fs;
use std::path::Path;

use super::{assert_writable, safe_slug};
use crate::fsutil::with_file_lock;

pub(super) fn rename_chat_at(root: &Path, old_slug: &str, new_slug: &str) -> Result<String, String> {
    let old_safe = safe_slug(old_slug)?;
    let new_safe = safe_slug(new_slug)?;
    assert_writable(&format!("chats/{old_safe}.md"))?;
    assert_writable(&format!("chats/{new_safe}.md"))?;
    let chats = root.join(crate::vault_roles::chats_dir(root));
    let old_path = chats.join(format!("{old_safe}.md"));
    let new_path = chats.join(format!("{new_safe}.md"));
    if !old_path.exists() {
        return Err(format!("chat not found: {old_safe}"));
    }
    if new_safe == old_safe {
        return Ok(new_safe);
    }
    // the move itself refuses a taken name, so a chat that appears there is
    // never replaced (chat audit 2026-11-24, D6)
    with_file_lock(&old_path, || {
        crate::fsutil::rename_no_replace(&old_path, &new_path).map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => format!("a chat named \"{new_safe}\" already exists"),
            std::io::ErrorKind::NotFound => format!("chat not found: {old_safe}"),
            _ => e.to_string(),
        })
    })?;
    Ok(new_safe)
}

pub(super) fn move_chat_to_bucket_at(root: &Path, slug: &str, bucket: &str) -> Result<(), String> {
    let safe = safe_slug(slug)?;
    let file = safe.clone() + ".md";
    assert_writable(&format!("chats/{file}"))?;
    let src = root.join(crate::vault_roles::chats_dir(root)).join(&file);
    if !src.exists() {
        return Err(format!("chat not found: {safe}"));
    }
    let dir = root.join(crate::vault_roles::chats_dir(root)).join(bucket);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // an earlier chat kept under this name stays: take the first free one,
    // `<slug>`, `<slug>-2`, … (chat audit 2026-11-24, D2)
    with_file_lock(&src, || {
        for n in 1..=CHAT_NAME_ATTEMPTS {
            let name = numbered_chat_slug(&safe, n);
            assert_writable(&format!("chats/{bucket}/{name}.md"))?;
            match crate::fsutil::rename_no_replace(&src, &dir.join(format!("{name}.md"))) {
                Ok(()) => return Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err(format!("chat not found: {safe}"))
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Err(format!("no free {bucket} name is left for {safe}"))
    })
}

/// Names a chat's Trash or Archive copy tries before the move gives up.
const CHAT_NAME_ATTEMPTS: u32 = 1000;

/// The n-th name for a chat: the name itself, then `<name>-2`, `<name>-3`, …
/// cut to fit `safe_slug`'s 80 characters, so a copy moved back by hand is a
/// valid chat again. The TypeScript twin is chatNames.ts `numberedChatSlug`.
pub(super) fn numbered_chat_slug(base: &str, n: u32) -> String {
    if n < 2 {
        return base.to_string();
    }
    let suffix = format!("-{n}");
    let keep = base.len().min(80 - suffix.len());
    format!("{}{suffix}", base[..keep].trim_end_matches('-'))
}
