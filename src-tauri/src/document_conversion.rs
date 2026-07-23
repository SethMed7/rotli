//! Local document-conversion adapters.
//!
//! PDF parsing and macOS textutil stay here so the corpus command owns only
//! path policy, source preservation, and managed-file creation.

use std::fs;
use std::path::Path;

const PDF_EXTRACTED_TEXT_MAX_BYTES: usize = 16_000_000;

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
