//! Image attachments for an ACP lane (2026-09-17: "I am pretty sure Gemini
//! supports it"). The Agent Client Protocol carries an image as a prompt
//! block — `{ type: "image", mimeType, data: <base64> }` — beside the text,
//! and an agent says whether it takes them in its `initialize` result
//! (`agentCapabilities.promptCapabilities.image`). Google's Antigravity agent
//! advertises `true`, so the lane sends the staged files as blocks; an agent
//! that advertises nothing refuses in words BEFORE a byte is sent, never
//! silently dropping the picture. acp.rs stays at its size ceiling; this is
//! the seam.

use base64::Engine as _;
use serde_json::{json, Value};

/// Whether the agent's `initialize` result advertises image prompt blocks.
pub(crate) fn agent_takes_images(init: &Value) -> bool {
    init.pointer("/agentCapabilities/promptCapabilities/image")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// The mime type the bytes actually are (the staged files are named `.png`
/// whatever the composer attached), from the magic numbers corpus.rs already
/// knows. Unknown bytes are sent as PNG rather than refused: the agent can
/// still say no.
pub(crate) fn image_mime(bytes: &[u8]) -> &'static str {
    [("jpg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")]
        .iter()
        .find(|(ext, _)| crate::corpus::image_payload_matches_extension(ext, bytes))
        .map_or("image/png", |(_, mime)| mime)
}

/// The prompt blocks for one turn: the text, then one image block per staged
/// file. With no images the capability is not consulted, so a text turn to an
/// older agent is unchanged.
pub(crate) fn prompt_blocks(
    init: &Value,
    prompt: &str,
    image_paths: &[String],
    label: &str,
) -> Result<Vec<Value>, String> {
    let mut blocks = vec![json!({ "type": "text", "text": prompt })];
    if image_paths.is_empty() {
        return Ok(blocks);
    }
    if !agent_takes_images(init) {
        return Err(format!(
            "{label} doesn't accept image attachments (its agent advertises no image prompts)"
        ));
    }
    for path in image_paths {
        let bytes = std::fs::read(path).map_err(|e| format!("couldn't read an attached image: {e}"))?;
        blocks.push(json!({
            "type": "image",
            "mimeType": image_mime(&bytes),
            "data": base64::engine::general_purpose::STANDARD.encode(&bytes),
        }));
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init(image: Option<bool>) -> Value {
        match image {
            Some(flag) => json!({ "agentCapabilities": { "promptCapabilities": { "image": flag } } }),
            None => json!({ "agentCapabilities": {} }),
        }
    }

    #[test]
    fn the_capability_is_read_from_initialize_and_defaults_to_no() {
        assert!(agent_takes_images(&init(Some(true))));
        assert!(!agent_takes_images(&init(Some(false))));
        assert!(!agent_takes_images(&init(None)));
        assert!(!agent_takes_images(&json!({})));
    }

    #[test]
    fn the_mime_follows_the_bytes_not_the_file_name() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n..."), "image/png");
        assert_eq!(image_mime(b"\xff\xd8\xff\xe0.."), "image/jpeg");
        assert_eq!(image_mime(b"GIF89a...."), "image/gif");
        assert_eq!(image_mime(b"RIFF....WEBPVP8 "), "image/webp");
        assert_eq!(image_mime(b"who knows"), "image/png");
    }

    #[test]
    fn a_turn_with_images_sends_text_then_one_block_per_file() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("image-1.png");
        std::fs::write(&png, b"\x89PNG\r\n\x1a\nbytes").unwrap();
        let jpg = dir.path().join("image-2.png");
        std::fs::write(&jpg, b"\xff\xd8\xff\xe0jpeg").unwrap();
        let paths = [png.to_string_lossy().to_string(), jpg.to_string_lossy().to_string()];
        let blocks = prompt_blocks(&init(Some(true)), "what is this?", &paths, "Antigravity").unwrap();
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0], json!({ "type": "text", "text": "what is this?" }));
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
        assert_eq!(
            blocks[1]["data"],
            base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nbytes")
        );
        assert_eq!(blocks[2]["mimeType"], "image/jpeg");
    }

    #[test]
    fn an_agent_without_image_prompts_refuses_before_reading_a_file() {
        let paths = ["/nonexistent/rotli-image.png".to_string()];
        let refused = prompt_blocks(&init(None), "p", &paths, "Antigravity").unwrap_err();
        assert!(refused.contains("image attachments"), "{refused}");
        // no images: the capability is never consulted, the text goes as before
        let text_only = prompt_blocks(&init(None), "p", &[], "Antigravity").unwrap();
        assert_eq!(text_only, vec![json!({ "type": "text", "text": "p" })]);
    }
}
