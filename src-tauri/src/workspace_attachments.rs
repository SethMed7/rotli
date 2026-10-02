//! A note's attachments for agents (docs/architecture/agent-workspace.md,
//! "Attachments"): the files its Markdown links and images name, resolved the
//! way the editor resolves them (`resolveImageSrc` in src/lib/tauri.ts):
//! `storage:NAME` is `storage/NAME` and a bare relative path is
//! corpus-relative. External URLs are listed, never fetched.
//!
//! The note itself must pass the remote read gate first, so a secure note's
//! attachments are never enumerated. Each file then takes the document lane's
//! records gate (surface + secure-keyword name), and any text returned takes
//! the egress secret check. Binaries are described (path, MIME type, size),
//! never base64-encoded.

use std::path::Path;

use serde_json::{json, Value};

use super::Workspace;

/// At most this many attachments are described per note.
const MAX_ATTACHMENTS: usize = 100;
/// The default and largest text read, in bytes.
pub(super) const TEXT_DEFAULT_BYTES: usize = 20_000;
pub(super) const TEXT_MAX_BYTES: usize = 200_000;

/// Every link or image target in the body outside fenced code, in order.
pub(super) fn link_targets(body: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut fenced = false;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let mut rest = line;
        while let Some(at) = rest.find("](") {
            let after = &rest[at + 2..];
            let Some(end) = after.find(')') else { break };
            let raw = after[..end].trim();
            let raw = match raw.strip_prefix('<') {
                Some(inner) => inner.split('>').next().unwrap_or_default(),
                // a link title (`src "title"`) follows the first space
                None => raw.split_whitespace().next().unwrap_or_default(),
            };
            if !raw.is_empty() {
                targets.push(raw.to_string());
            }
            rest = &after[end + 1..];
        }
    }
    targets
}

/// The corpus-relative path a link names, or `None` for an external URL, an
/// anchor, or a path that could leave the vault.
pub(super) fn attachment_rel(source: &str) -> Option<String> {
    let lower = source.to_ascii_lowercase();
    if source.starts_with('#')
        || source.starts_with('/')
        || lower.contains("://")
        || ["mailto:", "data:", "tel:", "rotli:", "blob:", "asset:"]
            .iter()
            .any(|scheme| lower.starts_with(scheme))
    {
        return None;
    }
    let path = source.split(['#', '?']).next().unwrap_or_default();
    let decoded = percent_encoding::percent_decode_str(path).decode_utf8().ok()?;
    let rel = match decoded.strip_prefix("storage:") {
        Some(name) => format!("storage/{name}"),
        None => decoded.into_owned(),
    };
    crate::corpus::validate_rel(&rel).ok()?;
    (!rel.is_empty()).then_some(rel)
}

/// Images by the clipboard lane's own table; the rest by extension here.
pub(super) fn mime_of(rel: &str) -> &'static str {
    if let Some(image) = crate::clipboard_assets::mime_of(rel) {
        return image;
    }
    let ext = Path::new(rel)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "excalidraw" => "application/vnd.excalidraw+json",
        "md" | "markdown" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "txt" | "log" | "yaml" | "yml" | "toml" | "tsv" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn is_text(mime: &str) -> bool {
    mime.starts_with("text/") || mime == "application/json"
}

impl Workspace {
    /// Describe the attachments of one agent-readable note. `text_bytes` asks
    /// for the contents of small text attachments (capped); `local` adds the
    /// absolute path, which only a caller on this Mac can use.
    pub(super) fn attachments(
        &mut self,
        local_id: &str,
        text_bytes: Option<usize>,
        local: bool,
    ) -> Result<Value, String> {
        let note = self.read_note(local_id)?;
        let mut seen = std::collections::HashSet::new();
        let mut external = Vec::new();
        let mut files = Vec::new();
        for source in link_targets(&note.note.body) {
            let Some(rel) = attachment_rel(&source) else {
                if source.contains("://") && external.len() < MAX_ATTACHMENTS {
                    external.push(source);
                }
                continue;
            };
            if !seen.insert(rel.clone()) || files.len() >= MAX_ATTACHMENTS {
                continue;
            }
            files.push(self.describe_attachment(&source, &rel, text_bytes, local));
        }
        Ok(json!({
            "note": { "id": note.note.id, "revision": note.revision },
            "attachments": files,
            "external": external,
        }))
    }

    fn describe_attachment(
        &mut self,
        source: &str,
        rel: &str,
        text_bytes: Option<usize>,
        local: bool,
    ) -> Value {
        let mut out = json!({ "source": source, "path": rel });
        let stem = Path::new(rel).file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        if !self.store.agent_listable(rel) || self.store.secure_by_name(stem, rel) {
            out["available"] = json!(false);
            out["reason"] = json!("not available to agents");
            return out;
        }
        let Some(path) = self.store.guard_rel(rel).ok().filter(|path| path.is_file()) else {
            out["available"] = json!(false);
            out["reason"] = json!("missing");
            return out;
        };
        let mime = mime_of(rel);
        let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or_default();
        out["available"] = json!(true);
        out["mime"] = json!(mime);
        out["size"] = json!(size);
        out["kind"] = json!(match mime {
            "text/markdown" => "note",
            m if m.starts_with("image/") => "image",
            m if m.starts_with("video/") => "video",
            m if m.starts_with("audio/") => "audio",
            m if is_text(m) => "text",
            _ => "binary",
        });
        if local {
            out["absPath"] = json!(path);
        }
        // a linked note is read through the note lane, never as raw text
        let Some(cap) = text_bytes.filter(|_| is_text(mime) && mime != "text/markdown") else {
            return out;
        };
        let cap = cap.clamp(1, TEXT_MAX_BYTES);
        let Ok(bytes) = std::fs::read(&path) else {
            return out;
        };
        let text = String::from_utf8_lossy(&bytes[..bytes.len().min(cap)]).into_owned();
        if crate::secret::blocked_for_remote(&text) {
            out["text"] = Value::Null;
            out["withheld"] = json!("secret-shaped text");
        } else {
            out["text"] = json!(text);
            out["truncated"] = json!(bytes.len() > cap);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::test_workspace;
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn targets_skip_code_fences_and_link_titles() {
        let body = "![a](storage:img/a.png) [doc](notes/b.csv \"Title\")\n```\n![x](storage:no.png)\n```\n[w](<my file.txt>) [s](https://e.test/x)";
        assert_eq!(
            link_targets(body),
            ["storage:img/a.png", "notes/b.csv", "my file.txt", "https://e.test/x"]
        );
    }

    #[test]
    fn sources_resolve_like_the_editor_and_never_leave_the_vault() {
        assert_eq!(attachment_rel("storage:img/a%20b.png").as_deref(), Some("storage/img/a b.png"));
        assert_eq!(attachment_rel("wiki/x.pdf#page=2").as_deref(), Some("wiki/x.pdf"));
        for refused in ["https://e.test/a.png", "/etc/passwd", "../out.txt", "storage:../../x", "#anchor", "mailto:a@b.c"] {
            assert_eq!(attachment_rel(refused), None, "{refused}");
        }
    }

    #[test]
    fn attachments_describe_images_read_small_text_and_withhold_secrets() {
        let temp = TempDir::new().unwrap();
        let mut ws = test_workspace(&temp);
        fs::create_dir_all(temp.path().join("storage")).unwrap();
        fs::write(temp.path().join("storage/pic.png"), [0x89, b'P', b'N', b'G']).unwrap();
        fs::write(temp.path().join("storage/data.csv"), "a,b\n1,2\n").unwrap();
        fs::write(temp.path().join("storage/key.txt"), "sk-ant-abcdefghijklmnopqrstuvwxyz0123").unwrap();
        let note = ws
            .create_note(
                "With files",
                "![p](storage:pic.png) [d](storage:data.csv) [k](storage:key.txt) [m](storage:gone.png) [u](https://e.test)",
                super::super::MAIN_ROOT,
            )
            .unwrap();

        let out = ws.attachments(&note.id, Some(TEXT_DEFAULT_BYTES), true).unwrap();
        let files = out["attachments"].as_array().unwrap();
        assert_eq!(files[0]["kind"], "image");
        assert_eq!(files[0]["mime"], "image/png");
        assert_eq!(files[0]["size"], 4);
        assert!(files[0].get("text").is_none(), "binaries are never inlined");
        assert!(files[0]["absPath"].as_str().unwrap().ends_with("storage/pic.png"));
        assert_eq!(files[1]["text"], "a,b\n1,2\n");
        assert_eq!(files[2]["withheld"], "secret-shaped text");
        assert_eq!(files[3]["reason"], "missing");
        assert_eq!(out["external"], json!(["https://e.test"]));

        // a remote caller gets no absolute path
        let remote = ws.attachments(&note.id, None, false).unwrap();
        assert!(remote["attachments"][0].get("absPath").is_none());
    }

    #[test]
    fn a_secure_notes_attachments_are_never_enumerated() {
        let temp = TempDir::new().unwrap();
        let mut ws = test_workspace(&temp);
        let secure = ws
            .store
            .create_with_policy("Secure notes", "# Private\n\n![p](storage:pic.png)", true)
            .unwrap();
        assert!(ws.attachments(&secure.id, None, true).is_err());
    }
}
