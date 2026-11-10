//! Image bytes for the clipboard. A copy that spans an image puts real HTML on
//! the pasteboard; outside Rotli an `asset://` URL resolves to nothing, so the
//! webview asks for the image as a `data:` URL and inlines it. Same traversal
//! guard as every other corpus read; images only; capped.

use base64::Engine;

use crate::corpus::{validate_rel, CorpusState};

/// Largest image inlined into a copy (a 12 MB PNG is already a poor paste).
const MAX_DATA_URL_BYTES: usize = 12_000_000;

/// The MIME type of an image Rotli shows, by extension; `None` for anything else.
pub(crate) fn mime_of(rel: &str) -> Option<&'static str> {
    let ext = rel.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "heic" => "image/heic",
        _ => return None,
    })
}

/// A corpus image (`storage:` or corpus-relative) as a `data:` URL.
#[tauri::command]
pub fn corpus_image_data_url(
    state: tauri::State<'_, CorpusState>,
    root_id: String,
    rel: String,
) -> Result<String, String> {
    validate_rel(&rel)?;
    let mime = mime_of(&rel).ok_or_else(|| format!("not an image: {rel}"))?;
    let abs = state.route(&root_id, |s| s.guard_rel(&rel))?;
    data_url_of(&abs, mime)
}

/// A vault image as a data URL, read through the checked open: never a hard
/// link to a file elsewhere (second review of PR #267).
fn data_url_of(abs: &std::path::Path, mime: &str) -> Result<String, String> {
    let mut file = crate::fsutil::open_own_file(abs).map_err(|e| format!("not a file of its own: {e}"))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len() as usize;
    if len > MAX_DATA_URL_BYTES {
        return Err(format!("image too large to inline ({len} bytes)"));
    }
    let mut bytes = Vec::with_capacity(len);
    std::io::Read::read_to_end(&mut file, &mut bytes).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::{data_url_of, mime_of};

    #[cfg(unix)]
    #[test]
    fn a_hard_linked_image_is_never_inlined() {
        let vault = tempfile::TempDir::new().unwrap();
        let abs = vault.path().join("storage/linked.png");
        let _outside = crate::fsutil::hard_link_outside(&abs, b"\x89PNG outside the vault");
        assert!(data_url_of(&abs, "image/png").is_err());
        std::fs::write(vault.path().join("storage/own.png"), b"\x89PNG").unwrap();
        assert!(data_url_of(&vault.path().join("storage/own.png"), "image/png").unwrap().starts_with("data:image/png"));
    }

    #[test]
    fn only_image_extensions_get_a_mime() {
        assert_eq!(mime_of("storage/a.PNG"), Some("image/png"));
        assert_eq!(mime_of("x.jpeg"), Some("image/jpeg"));
        assert_eq!(mime_of("notes.md"), None);
        assert_eq!(mime_of("noext"), None);
    }
}
