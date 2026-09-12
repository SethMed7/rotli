//! Local document-conversion adapters.
//!
//! PDF parsing and macOS textutil stay here so the corpus command owns only
//! path policy, source preservation, and managed-file creation.

use std::fs;
use std::path::{Path, PathBuf};

const PDF_EXTRACTED_TEXT_MAX_BYTES: usize = 16_000_000;

fn markdown_to_print_text(title: &str, markdown: &str) -> String {
    let link = regex::Regex::new(r"!?\[([^\]]*)\]\([^)]*\)").expect("static markdown link regex");
    let mut lines = Vec::new();
    let mut in_fence = false;
    let mut first_content = true;
    for raw in markdown.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let trimmed = raw.trim();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        let mut line = if in_fence {
            raw.trim_end().to_string()
        } else {
            trimmed.trim_start_matches('#').trim_start().to_string()
        };
        if !in_fence {
            if let Some(rest) = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
                line = format!("• {rest}");
            }
            line = link.replace_all(&line, "$1").into_owned();
            for marker in ["**", "__", "~~", "`"] {
                line = line.replace(marker, "");
            }
            // a table cell's `<br>` line break prints as a space
            line = line.replace("<br>", " ").replace("<br/>", " ");
        }
        if first_content && !line.trim().is_empty() {
            first_content = false;
            if line.trim().eq_ignore_ascii_case(title.trim()) {
                continue;
            }
        }
        if line.trim().is_empty() {
            if lines
                .last()
                .is_some_and(|previous: &String| !previous.is_empty())
            {
                lines.push(String::new());
            }
        } else {
            lines.push(line);
        }
    }
    while lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    let mut out = title.trim().to_string();
    if !out.is_empty() && !lines.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(&lines.join("\n"));
    out.push('\n');
    out
}

const PDF_EXPORT_MAX_BYTES: usize = 32_000_000;

/// Where the themed renderer's script lives for a vault: the materialized
/// runtime when Breve manages this vault (it has its dependencies installed),
/// otherwise Rotli's bundled runtime source (the renderer imports only local,
/// dependency-free modules, so it runs from there too). None when neither
/// exists — the caller falls back to the plain-text exporter.
pub(crate) fn themed_pdf_renderer(root: &Path, bundled_runtime: Option<&Path>) -> Option<PathBuf> {
    let managed = root
        .join(crate::routines::MANAGED_DIR)
        .join("scripts/render-document.ts");
    if managed.is_file() {
        return Some(managed);
    }
    bundled_runtime
        .map(|dir| dir.join("scripts/render-document.ts"))
        .filter(|script| script.is_file())
}

/// Render a note through the same themed HTML→PDF lane the Breve briefs use
/// (`render-document.ts` → the user's Rotli palette from the routine config →
/// headless Chrome). Returns None, with the reason, when the lane cannot run
/// here (no bun, no Chromium-family browser, renderer error) so the caller can
/// fall back to the plain-text exporter instead of failing the artifact.
pub(crate) fn export_markdown_pdf_bytes_themed(
    root: &Path,
    renderer: &Path,
    bun: &Path,
    title: &str,
    markdown: &str,
) -> Result<Vec<u8>, String> {
    let temp = tempfile::tempdir().map_err(|error| format!("create PDF export workspace: {error}"))?;
    let input = temp.path().join("note.md");
    let output = temp.path().join("note.pdf");
    fs::write(&input, markdown).map_err(|error| format!("prepare PDF source: {error}"))?;
    let status = std::process::Command::new(bun)
        .arg(renderer)
        .arg("--in")
        .arg(&input)
        .arg("--out")
        .arg(&output)
        .arg("--title")
        .arg(title)
        .current_dir(temp.path())
        .envs(crate::routines::env::breve_runtime_env(root))
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("start the themed PDF renderer: {error}"))?;
    if !status.status.success() {
        let detail = String::from_utf8_lossy(&status.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "the themed PDF renderer did not produce a copy".into()
        } else {
            format!("themed PDF renderer: {}", detail.chars().take(300).collect::<String>())
        });
    }
    let bytes = fs::read(&output).map_err(|error| format!("read rendered PDF: {error}"))?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("the themed PDF renderer did not produce a valid PDF copy".into());
    }
    if bytes.len() > PDF_EXPORT_MAX_BYTES {
        return Err("The generated PDF is too large for the managed export lane.".into());
    }
    Ok(bytes)
}

/// Export a note to PDF bytes: the themed renderer when this vault (or the
/// bundled runtime) has one and bun + a Chromium-family browser are present,
/// otherwise the plain-text macOS exporter. Never fails the artifact just
/// because the pretty lane is unavailable.
pub(crate) fn export_note_pdf_bytes(
    root: &Path,
    bundled_runtime: Option<&Path>,
    title: &str,
    markdown: &str,
) -> Result<Vec<u8>, String> {
    if let Some(script) = themed_pdf_renderer(root, bundled_runtime) {
        match export_markdown_pdf_bytes_themed(root, &script, &crate::memex::find_bun(), title, markdown) {
            Ok(bytes) => return Ok(bytes),
            Err(reason) => eprintln!("themed PDF export unavailable, using plain text: {reason}"),
        }
    }
    #[cfg(target_os = "macos")]
    {
        export_markdown_pdf_bytes(title, markdown)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (title, markdown);
        Err("Local PDF export needs a Chromium-family browser on this platform.".into())
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn export_markdown_pdf_bytes(title: &str, markdown: &str) -> Result<Vec<u8>, String> {
    let printable = markdown_to_print_text(title, markdown);
    if printable.trim().is_empty() {
        return Err("The editable source is empty, so there is nothing to export.".into());
    }
    let temp =
        tempfile::tempdir().map_err(|error| format!("create PDF export workspace: {error}"))?;
    let input = temp.path().join("editable-source.txt");
    fs::write(&input, printable).map_err(|error| format!("prepare PDF source: {error}"))?;
    let output = std::process::Command::new("/usr/sbin/cupsfilter")
        .args(["-i", "text/plain", "-m", "application/pdf", "--"])
        .arg(&input)
        .output()
        .map_err(|error| format!("start the macOS PDF exporter: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "The macOS PDF exporter could not create a copy.".into()
        } else {
            format!("The macOS PDF exporter failed: {detail}")
        });
    }
    if !output.stdout.starts_with(b"%PDF-") {
        return Err("The local exporter did not produce a valid PDF copy.".into());
    }
    if output.stdout.len() > PDF_EXPORT_MAX_BYTES {
        return Err("The generated PDF is too large for the managed export lane.".into());
    }
    Ok(output.stdout)
}

fn pdf_pages_to_editable_text(pages: Vec<String>) -> Result<String, String> {
    if pages.iter().all(|page| page.trim().is_empty()) {
        return Err(
            "This PDF has no embedded text to convert. It may be scanned; run OCR first, then try again."
                .into(),
        );
    }
    let mut text = String::new();
    for page in pages {
        if page.trim().is_empty() {
            continue;
        }
        if !text.is_empty() {
            // A form feed gives textutil an honest page boundary without
            // inserting synthetic "Page 2" text into the user's document.
            text.push_str("\n\n\u{000c}\n\n");
        }
        text.push_str(page.trim_end());
        if text.len() > PDF_EXTRACTED_TEXT_MAX_BYTES {
            return Err("The extracted PDF text is too large for safe local conversion.".into());
        }
    }
    Ok(text)
}

#[cfg(target_os = "macos")]
fn pdf_text_for_docx(source: &Path) -> Result<String, String> {
    let extracted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_extract::extract_text_by_pages(source)
    }))
    .map_err(|_| "The local PDF reader could not safely parse this file.".to_string())?
    .map_err(|error| format!("The local PDF reader could not extract text: {error}"))?;
    pdf_pages_to_editable_text(extracted)
}

#[cfg(target_os = "macos")]
pub(crate) fn convert_document_bytes(source: &Path, ext: &str) -> Result<Vec<u8>, String> {
    let temp =
        tempfile::tempdir().map_err(|error| format!("create conversion workspace: {error}"))?;
    let output = temp.path().join("editable.docx");
    let input = if ext == "pdf" {
        let input = temp.path().join("editable.txt");
        fs::write(&input, pdf_text_for_docx(source)?)
            .map_err(|error| format!("prepare extracted PDF text: {error}"))?;
        input
    } else {
        source.to_path_buf()
    };

    let mut command = std::process::Command::new("/usr/bin/textutil");
    command.args(["-convert", "docx", "-output"]).arg(&output);
    if ext == "pdf" {
        // Arial is a standard macOS face and avoids carrying a source PDF's
        // unavailable or restricted font names into the editable copy.
        command.args(["-font", "Arial", "-fontsize", "11"]);
    }
    let command = command
        .arg("--")
        .arg(&input)
        .output()
        .map_err(|error| format!("start the macOS document converter: {error}"))?;
    if !command.status.success() {
        let detail = String::from_utf8_lossy(&command.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "The macOS document converter could not create an editable DOCX copy.".into()
        } else {
            format!("The macOS document converter failed: {detail}")
        });
    }
    let bytes = fs::read(&output).map_err(|error| format!("read converted DOCX: {error}"))?;
    if !bytes.starts_with(b"PK") {
        return Err("The local converter did not produce a valid DOCX package.".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_text_conversion_preserves_page_boundaries_and_refuses_scans() {
        assert_eq!(
            pdf_pages_to_editable_text(vec!["First page\n".into(), "Second page".into()]).unwrap(),
            "First page\n\n\u{000c}\n\nSecond page",
        );
        assert!(pdf_pages_to_editable_text(vec![" \n".into(), "\t".into()])
            .unwrap_err()
            .contains("run OCR first"));
    }

    #[test]
    fn markdown_pdf_export_keeps_readable_text_and_a_real_pdf_copy() {
        assert_eq!(
            markdown_to_print_text(
                "Launch",
                "# Launch\n\n## Goals\n\n- Ship **calmly**\n- Own [the source](https://example.com)"
            ),
            "Launch\n\nGoals\n\n• Ship calmly\n• Own the source\n",
        );
        #[cfg(target_os = "macos")]
        {
            let bytes = export_markdown_pdf_bytes("Launch", "## Goals\n\nShip calmly.").unwrap();
            assert!(bytes.starts_with(b"%PDF-"));
            assert!(bytes.len() > 1_000);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn embedded_text_pdf_converts_to_a_valid_docx_package() {
        fn minimal_pdf(text: &str) -> Vec<u8> {
            let stream = format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET");
            let objects = [
                "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
                format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
            ];
            let mut pdf = "%PDF-1.4\n".to_string();
            let mut offsets = Vec::new();
            for (index, object) in objects.iter().enumerate() {
                offsets.push(pdf.len());
                pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", index + 1));
            }
            let xref = pdf.len();
            pdf.push_str("xref\n0 6\n0000000000 65535 f \n");
            for offset in offsets {
                pdf.push_str(&format!("{offset:010} 00000 n \n"));
            }
            pdf.push_str(&format!(
                "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
            ));
            pdf.into_bytes()
        }

        let tmp = tempfile::TempDir::new().unwrap();
        let source = tmp.path().join("embedded-text.pdf");
        fs::write(&source, minimal_pdf("Rotli editable PDF")).unwrap();
        assert!(pdf_text_for_docx(&source)
            .unwrap()
            .contains("Rotli editable PDF"));
        assert!(convert_document_bytes(&source, "pdf")
            .unwrap()
            .starts_with(b"PK"));
    }
}
