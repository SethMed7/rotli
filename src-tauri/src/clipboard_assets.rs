//! Image bytes for the clipboard. A copy that spans an image puts real HTML on
//! the pasteboard; outside Rotli an `asset://` URL resolves to nothing, so the
//! webview asks for the image as a `data:` URL and inlines it. Same traversal
//! guard as every other corpus read; images only; capped.

use base64::Engine;

use crate::corpus::{validate_rel, CorpusState};

/// Largest image inlined into a copy (a 12 MB PNG is already a poor paste).
const MAX_DATA_URL_BYTES: usize = 12_000_000;

fn mime_of(rel: &str) -> Option<&'static str> {
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
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    let len = std::fs::metadata(&abs).map_err(|e| e.to_string())?.len() as usize;
    if len > MAX_DATA_URL_BYTES {
        return Err(format!("image too large to inline ({len} bytes)"));
    }
    let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::mime_of;

    #[test]
    fn only_image_extensions_get_a_mime() {
        assert_eq!(mime_of("storage/a.PNG"), Some("image/png"));
        assert_eq!(mime_of("x.jpeg"), Some("image/jpeg"));
        assert_eq!(mime_of("notes.md"), None);
        assert_eq!(mime_of("noext"), None);
    }
}
