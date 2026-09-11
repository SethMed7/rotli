//! Breve PDF appearance: the palette types the routine config carries and the
//! app-theme sync that keeps `pdfTheme.resolved` equal to the user's live Rotli
//! tokens (audit 2026-09-02 §1.4). The renderer (`breve-runtime/scripts/
//! pdf-theme.ts`) reads the same shapes; TS mirrors them in `src/lib/tauri.ts`.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::breve::{active_root, off_main, read_json, validate_config, write_json, BreveConfig, CONFIG_FILE};
use crate::corpus::CorpusState;
use crate::routines;

/// `Rotli` (the default since 2026-09-02) means "match my Rotli theme": the
/// main window resolves its live semantic tokens into `BrevePdfTheme::resolved`
/// through `breve_write_pdf_palette` whenever appearance changes, and the
/// renderer reads that palette. The named presets stay as explicit choices.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BrevePdfThemePreset {
    #[default]
    Rotli,
    Charcoal,
    WarmLight,
    WarmDark,
    Paper,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrevePdfPalette {
    pub background: String,
    pub surface: String,
    pub text: String,
    pub muted: String,
    pub accent: String,
    pub rule: String,
}

impl Default for BrevePdfPalette {
    fn default() -> Self {
        Self {
            background: "#161616".into(),
            surface: "#1f1e1c".into(),
            text: "#e9e7e2".into(),
            muted: "#a8a49c".into(),
            accent: "#d9a868".into(),
            rule: "#2e2c29".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrevePdfTheme {
    #[serde(default)]
    pub preset: BrevePdfThemePreset,
    #[serde(default)]
    pub custom: BrevePdfPalette,
    /// The app theme's six tokens as last written by the main window — what
    /// the `Rotli` preset renders with. Absent until the first appearance
    /// sync; the renderer then falls back to Warm Light, Rotli's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved: Option<BrevePdfPalette>,
}

static DEV_PDF_PALETTE: OnceLock<Mutex<Option<BrevePdfPalette>>> = OnceLock::new();

/// Merge the app theme's resolved palette into `pdfTheme.resolved` — a
/// slice write that never touches routines, delivery, or the preset choice,
/// so it is safe to fire from the appearance path while a Breve form is
/// dirty. Skips vaults Breve was never configured in (no config file) and
/// unchanged palettes, so an appearance toggle costs nothing at rest.
fn write_pdf_palette_at(root: &Path, palette: BrevePdfPalette) -> Result<bool, String> {
    let path = root.join(CONFIG_FILE);
    if !path.is_file() {
        return Ok(false);
    }
    // read-merge-write under the file lock: a Routines save can land in the
    // same instant as an appearance change (audit 2026-09-02 §6)
    crate::fsutil::with_file_lock(&path, || {
        let Some(mut config) = read_json::<BreveConfig>(&path) else {
            return Ok(false);
        };
        if config.pdf_theme.resolved.as_ref() == Some(&palette) {
            return Ok(false);
        }
        config.pdf_theme.resolved = Some(palette);
        validate_config(&config)?;
        write_json(&path, &config)?;
        Ok(true)
    })
}

#[tauri::command]
pub async fn breve_write_pdf_palette(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    palette: BrevePdfPalette,
) -> Result<(), String> {
    crate::feature_policy::require_breve()?;
    let root = active_root(&state)?;
    off_main(move || {
        if cfg!(debug_assertions) {
            let slot = DEV_PDF_PALETTE.get_or_init(|| Mutex::new(None));
            *slot.lock().map_err(|_| "dev PDF palette lock poisoned")? = Some(palette);
            return Ok(());
        }
        if write_pdf_palette_at(&root, palette)? {
            routines::mirror_shared_default(&app, "config.json", &root.join(CONFIG_FILE));
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::breve::{default_config, ROUTINES_DIR};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn pdf_theme_defaults_to_the_app_theme_and_validates_the_resolved_palette() {
        let config = default_config(true);
        assert_eq!(config.pdf_theme.preset, BrevePdfThemePreset::Rotli);
        assert!(config.pdf_theme.resolved.is_none());
        // a config written before the preset existed still deserializes as Rotli
        let legacy: BrevePdfTheme = serde_json::from_str("{}").unwrap();
        assert_eq!(legacy.preset, BrevePdfThemePreset::Rotli);
        let wire = serde_json::to_string(&config.pdf_theme).unwrap();
        assert!(wire.contains("\"preset\":\"rotli\""));
        assert!(!wire.contains("resolved"));
        let mut bad = config.clone();
        bad.pdf_theme.resolved = Some(BrevePdfPalette {
            accent: "oklch(53% 0.145 210)".into(),
            ..BrevePdfPalette::default()
        });
        assert!(validate_config(&bad).is_err());
    }

    #[test]
    fn pdf_palette_write_merges_into_an_existing_config_only() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(ROUTINES_DIR)).unwrap();
        let palette = BrevePdfPalette {
            background: "#f8f2e9".into(),
            surface: "#ffffff".into(),
            text: "#3a3028".into(),
            muted: "#6e6155".into(),
            accent: "#8f4e37".into(),
            rule: "#e7dbc9".into(),
        };
        // no config → Breve was never set up here; nothing is created
        assert!(!write_pdf_palette_at(root.path(), palette.clone()).unwrap());
        assert!(!root.path().join(CONFIG_FILE).exists());

        let mut config = default_config(true);
        config.timezone = "Europe/Lisbon".into();
        config.pdf_theme.preset = BrevePdfThemePreset::Paper;
        write_json(&root.path().join(CONFIG_FILE), &config).unwrap();
        assert!(write_pdf_palette_at(root.path(), palette.clone()).unwrap());
        let written = read_json::<BreveConfig>(&root.path().join(CONFIG_FILE)).unwrap();
        assert_eq!(written.pdf_theme.resolved.as_ref(), Some(&palette));
        // a slice write: the preset choice and everything else survive
        assert_eq!(written.pdf_theme.preset, BrevePdfThemePreset::Paper);
        assert_eq!(written.timezone, "Europe/Lisbon");
        // unchanged palette → no write
        assert!(!write_pdf_palette_at(root.path(), palette).unwrap());
    }
}
