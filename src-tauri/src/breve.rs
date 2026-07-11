//! Breve migration/control data seam.
//!
//! This module deliberately exposes a tiny, fixed-path contract. The webview
//! can read a normalized snapshot, write Rotli-owned routine config, update the
//! canonical watchlist note, copy the legacy Breve cache, and explicitly hand
//! scheduling ownership to Rotli. Paths remain fixed; the takeover is ordered
//! so legacy jobs stop before the managed scheduler marker becomes visible.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use regex::Regex;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use time::OffsetDateTime;
use tauri::Manager;

use crate::corpus::CorpusState;
use crate::keychain;
use crate::memex::find_bun;
use crate::routines::{self, BreveSupervisor, ManagedMarker};

const ROUTINES_DIR: &str = ".rotli/routines";
const CONFIG_FILE: &str = ".rotli/routines/config.json";
const CREATORS_FILE: &str = ".rotli/routines/creators.json";
const PAGES_FILE: &str = ".rotli/routines/pages.json";
const IMPORT_REPORT_FILE: &str = ".rotli/routines/import-report.json";
const WATCHLIST_FILE: &str = "wiki/reference/watchlist.md";
const BRIEFS_DIR: &str = "wiki/reference/briefs";
const BRIEF_ARTIFACTS_DIR: &str = "storage/breveBriefs";
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
static DEV_RESEND_CONFIGURED: AtomicBool = AtomicBool::new(false);
static DEV_DELIVERY_SETTINGS: OnceLock<Mutex<BreveDeliverySettings>> = OnceLock::new();
static DEV_WATCHLIST: OnceLock<Mutex<String>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveDeliveryTimes {
    pub morning: String,
    pub lunch: String,
    pub night: String,
}

impl Default for BreveDeliveryTimes {
    fn default() -> Self {
        Self { morning: "07:00".into(), lunch: "12:00".into(), night: "18:00".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveLeadOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub morning: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lunch: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub night: Option<u32>,
}

impl Default for BreveLeadOverrides {
    fn default() -> Self {
        Self { morning: Some(60), lunch: None, night: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveModelPolicy {
    pub primary: String,
    pub fallbacks: Vec<String>,
    pub local_helper: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BreveSchedule {
    DailyAt {
        hhmm: String,
        #[serde(rename = "leadMinutes")]
        lead_minutes: u32,
    },
    EverySecs { secs: u32 },
    AlwaysOn,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveRoutine {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub enabled: bool,
    pub schedule: BreveSchedule,
    pub lanes: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BrevePdfThemePreset {
    #[default]
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
    pub preset: BrevePdfThemePreset,
    pub custom: BrevePdfPalette,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveConfig {
    pub version: u32,
    pub timezone: String,
    pub delivery_times: BreveDeliveryTimes,
    pub lead_minutes: u32,
    pub lead_overrides: BreveLeadOverrides,
    pub brief_model: String,
    pub model_policy: BreveModelPolicy,
    #[serde(default)]
    pub pdf_theme: BrevePdfTheme,
    pub routines: Vec<BreveRoutine>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub travel: Option<BreveTravel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveTravel {
    pub start: String,
    pub end: String,
    pub tz: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveCreator {
    pub name: String,
    pub handle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrevePage {
    pub id: u64,
    pub url: String,
    #[serde(default)]
    pub condition: String,
    /** Watcher-owned baseline/failure fields survive the UI snapshot round-trip. */
    #[serde(flatten)]
    pub runtime: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveBrief {
    pub stem: String,
    pub title: String,
    pub kind: String,
    pub date: String,
    pub imported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BreveCounts {
    pub sections: usize,
    pub topics: usize,
    pub creators: usize,
    pub pages: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BreveSource {
    Rotli,
    Legacy,
    Empty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BreveScheduler {
    #[serde(rename = "rotli")]
    Rotli,
    #[serde(rename = "legacy-launchd")]
    LegacyLaunchd,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveSnapshot {
    pub source: BreveSource,
    pub legacy_root: Option<String>,
    pub config: BreveConfig,
    pub watchlist: String,
    pub counts: BreveCounts,
    pub creators: Vec<BreveCreator>,
    pub pages: Vec<BrevePage>,
    pub briefs: Vec<BreveBrief>,
    pub artifact_count: usize,
    pub imported: bool,
    pub scheduler: BreveScheduler,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BreveDeliverySettings {
    pub email_from: String,
    pub email_to: Vec<String>,
    pub signal_bot: String,
    pub signal_owner: String,
    pub signal_owner_uuid: String,
    #[serde(default)]
    pub resend_key_configured: bool,
}

fn production_roots_for_dev(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(config_dir) = app.path().app_config_dir() {
        if let Some(config) = fs::read_to_string(config_dir.join("corpus.json"))
            .ok()
            .and_then(|body| serde_json::from_str::<crate::corpus::CorpusConfig>(&body).ok())
        {
            roots.push(config.corpus.abs_path);
        }
    }
    if let Some(root) = std::env::var_os("MEMEX_KNOWLEDGE").map(PathBuf::from) {
        roots.push(root);
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.push(home.join("memex-vault"));
        roots.push(home.join("Documents/rotli"));
    }
    roots
}

fn production_resend_configured_for_dev(home: &Path) -> bool {
    if keychain::production_secret_exists_for_dev("breve-resend-api-key") {
        return true;
    }
    Command::new(find_bun())
        .arg(home.join("scripts/secret.ts"))
        .args(["get", "resend-breve"])
        .current_dir(home)
        .env("ROTLI_BREVE_HOME", home)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn production_delivery_settings_for_dev(app: &tauri::AppHandle) -> Option<BreveDeliverySettings> {
    production_roots_for_dev(app).into_iter().find_map(|root| {
        let home = root.join(routines::MANAGED_DIR);
        (home.join("recipients.json").is_file() || home.join("signal.json").is_file()).then(|| {
            delivery_settings_at(&home, production_resend_configured_for_dev(&home))
        })
    })
}

fn dev_delivery_settings(app: &tauri::AppHandle) -> BreveDeliverySettings {
    let state = DEV_DELIVERY_SETTINGS.get_or_init(|| {
        let settings = production_delivery_settings_for_dev(app).unwrap_or_else(|| BreveDeliverySettings {
            email_from: "Breve <briefs@example.com>".into(),
            email_to: vec!["you@example.com".into()],
            signal_bot: "+14075550101".into(),
            signal_owner: "+14075550102".into(),
            signal_owner_uuid: String::new(),
            resend_key_configured: false,
        });
        DEV_RESEND_CONFIGURED.store(settings.resend_key_configured, Ordering::SeqCst);
        Mutex::new(settings)
    });
    let mut settings = state.lock().map(|value| value.clone()).unwrap_or_default();
    settings.resend_key_configured = DEV_RESEND_CONFIGURED.load(Ordering::SeqCst);
    settings
}

fn fallback_dev_watchlist() -> String {
    "# Breve Watchlist\n\n## AI and tools\n\n| Watch | Lens |\n|---|---|\n| Rotli | product changes |\n".into()
}

/// Seed Tauri dev from the user's production watchlist without connecting the
/// dev corpus to production. The value is copied into memory once; all edits
/// made by the dev UI remain in memory and are discarded when dev restarts.
fn production_watchlist_for_dev(app: &tauri::AppHandle) -> Option<String> {
    production_roots_for_dev(app)
        .into_iter()
        .map(|root| root.join(WATCHLIST_FILE))
        .find_map(|path| read_text(&path))
}

fn dev_watchlist(app: &tauri::AppHandle) -> String {
    DEV_WATCHLIST
        .get_or_init(|| Mutex::new(production_watchlist_for_dev(app).unwrap_or_else(fallback_dev_watchlist)))
        .lock()
        .map(|watchlist| watchlist.clone())
        .unwrap_or_else(|_| fallback_dev_watchlist())
}

fn set_dev_watchlist(app: &tauri::AppHandle, markdown: String) {
    let watchlist = DEV_WATCHLIST
        .get_or_init(|| Mutex::new(production_watchlist_for_dev(app).unwrap_or_else(fallback_dev_watchlist)));
    if let Ok(mut current) = watchlist.lock() {
        *current = markdown;
    }
}

fn dev_breve_snapshot(app: &tauri::AppHandle) -> BreveSnapshot {
    let watchlist = dev_watchlist(app);
    let (sections, topics) = watchlist_counts(&watchlist);
    BreveSnapshot {
        source: BreveSource::Rotli,
        legacy_root: None,
        config: default_config(true),
        watchlist,
        counts: BreveCounts { sections, topics, creators: 4, pages: 3 },
        creators: Vec::new(),
        pages: Vec::new(),
        briefs: vec![
            BreveBrief { stem: "2026-07-10".into(), title: "Breve — July 10, 2026".into(), kind: "morning".into(), date: "2026-07-10".into(), imported: true, path: None },
            BreveBrief { stem: "2026-07-10-lunch".into(), title: "Breve — July 10, 2026 · Lunchtime".into(), kind: "lunch".into(), date: "2026-07-10".into(), imported: true, path: None },
            BreveBrief { stem: "2026-07-09-night".into(), title: "Breve — July 9, 2026 · The Archive".into(), kind: "night".into(), date: "2026-07-09".into(), imported: true, path: None },
        ],
        artifact_count: 208,
        imported: true,
        scheduler: BreveScheduler::Rotli,
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportReport {
    version: u32,
    imported_at: String,
    source: String,
    config_written: bool,
    watchlist_written: bool,
    creators_written: bool,
    pages_written: bool,
    briefs_copied: usize,
    brief_artifacts_copied: usize,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacySettings {
    timezone: Option<String>,
    lead_minutes: Option<u32>,
    lead_overrides: Option<HashMap<String, u32>>,
    delivery_times: Option<BreveDeliveryTimes>,
    brief_model: Option<String>,
    travel: Option<BreveTravel>,
}

fn legacy_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).map(|home| home.join("breve"))
}

fn now_date() -> String {
    OffsetDateTime::now_utc().date().to_string()
}

fn now_stamp() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .unwrap_or_else(|_| OffsetDateTime::now_utc())
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| now_date())
}

fn read_text(path: &Path) -> Option<String> {
    let meta = fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_TEXT_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_str(&read_text(path)?).ok()
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| format!("no parent for {}", path.display()))?;
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".rotli-breve-")
        .tempfile_in(dir)
        .map_err(|e| format!("temp file in {}: {e}", dir.display()))?;
    tmp.write_all(bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    tmp.as_file().sync_all().map_err(|e| format!("sync {}: {e}", path.display()))?;
    tmp.persist(path).map_err(|e| format!("rename into {}: {e}", path.display()))?;
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let mut out = serde_json::to_vec_pretty(value).map_err(|e| format!("encode {}: {e}", path.display()))?;
    out.push(b'\n');
    write_atomic(path, &out)
}

fn default_routines(enabled: bool, times: &BreveDeliveryTimes, lead: u32, overrides: &BreveLeadOverrides) -> Vec<BreveRoutine> {
    let daily = |id: &str, label: &str, hhmm: &str, lead_minutes: u32| BreveRoutine {
        id: id.into(),
        label: label.into(),
        kind: "brief".into(),
        enabled,
        schedule: BreveSchedule::DailyAt { hhmm: hhmm.into(), lead_minutes },
        lanes: vec!["inApp".into(), "signal".into(), "email".into()],
    };
    vec![
        daily("morning", "Morning brief", &times.morning, overrides.morning.unwrap_or(lead)),
        daily("lunch", "Lunch Pivot", &times.lunch, overrides.lunch.unwrap_or(lead)),
        daily("night", "Nightcap", &times.night, overrides.night.unwrap_or(lead)),
        BreveRoutine {
            id: "creators".into(), label: "Creator alerts".into(), kind: "creators".into(), enabled,
            schedule: BreveSchedule::EverySecs { secs: 3_600 }, lanes: vec!["signal".into()],
        },
        BreveRoutine {
            id: "watchers".into(), label: "Page watchers".into(), kind: "watchers".into(), enabled,
            schedule: BreveSchedule::EverySecs { secs: 1_800 }, lanes: vec!["signal".into()],
        },
        BreveRoutine {
            id: "doctor".into(), label: "Health check".into(), kind: "doctor".into(), enabled,
            schedule: BreveSchedule::EverySecs { secs: 1_800 }, lanes: vec!["inApp".into(), "signal".into()],
        },
        BreveRoutine {
            id: "signal".into(), label: "Signal listener".into(), kind: "signal".into(), enabled,
            schedule: BreveSchedule::AlwaysOn, lanes: vec!["signal".into()],
        },
    ]
}

fn default_config(enabled: bool) -> BreveConfig {
    let delivery_times = BreveDeliveryTimes::default();
    let lead_overrides = BreveLeadOverrides::default();
    let lead_minutes = 30;
    let brief_model = "sonnet".to_string();
    BreveConfig {
        version: 1,
        timezone: "America/New_York".into(),
        delivery_times: delivery_times.clone(),
        lead_minutes,
        lead_overrides: lead_overrides.clone(),
        brief_model: brief_model.clone(),
        model_policy: BreveModelPolicy {
            primary: brief_model.clone(),
            fallbacks: vec!["haiku".into(), "Gemini 3.5 Flash (Medium)".into(), "gpt-5.4-mini".into()],
            local_helper: Some("gemma-3-12b-it-qat-4bit".into()),
        },
        pdf_theme: BrevePdfTheme::default(),
        routines: default_routines(enabled, &delivery_times, lead_minutes, &lead_overrides),
        travel: None,
    }
}

fn legacy_config(root: &Path) -> BreveConfig {
    let settings = read_json::<LegacySettings>(&root.join("settings.json")).unwrap_or_default();
    let mut out = default_config(true);
    if let Some(v) = settings.timezone.filter(|v| !v.trim().is_empty()) {
        out.timezone = v;
    }
    if let Some(v) = settings.delivery_times {
        out.delivery_times = v;
    }
    if let Some(v) = settings.lead_minutes {
        out.lead_minutes = v;
    }
    if let Some(v) = settings.lead_overrides {
        out.lead_overrides = BreveLeadOverrides {
            morning: v.get("morning").copied(),
            lunch: v.get("lunch").copied(),
            night: v.get("night").copied(),
        };
    }
    if let Some(v) = settings.brief_model.filter(|v| !v.trim().is_empty()) {
        out.brief_model = v;
    }
    out.travel = settings.travel;
    out.model_policy.primary = out.brief_model.clone();
    if let Some(local) = read_json::<serde_json::Value>(&root.join("config.local.json")) {
        let provider = local.pointer("/llm/provider").and_then(|v| v.as_str()).unwrap_or("mlx");
        let model = local
            .pointer(&format!("/llm/providers/{provider}/model"))
            .and_then(|v| v.as_str())
            .or_else(|| local.pointer("/llm/model").and_then(|v| v.as_str()));
        out.model_policy.local_helper = model.map(str::to_string);
    }
    out.routines = default_routines(true, &out.delivery_times, out.lead_minutes, &out.lead_overrides);
    out
}

fn valid_hhmm(value: &str) -> bool {
    let Some((h, m)) = value.split_once(':') else { return false };
    h.len() == 2
        && m.len() == 2
        && h.parse::<u8>().is_ok_and(|v| v < 24)
        && m.parse::<u8>().is_ok_and(|v| v < 60)
}

fn validate_config(config: &BreveConfig) -> Result<(), String> {
    if config.version != 1 {
        return Err("unsupported Breve config version".into());
    }
    if config.timezone.trim().is_empty() || config.timezone.len() > 96 {
        return Err("Breve timezone is invalid".into());
    }
    for value in [&config.delivery_times.morning, &config.delivery_times.lunch, &config.delivery_times.night] {
        if !valid_hhmm(value) {
            return Err(format!("invalid Breve delivery time: {value}"));
        }
    }
    if config.lead_minutes > 24 * 60
        || [config.lead_overrides.morning, config.lead_overrides.lunch, config.lead_overrides.night]
            .into_iter()
            .flatten()
            .any(|v| v > 24 * 60)
    {
        return Err("Breve lead time must be at most 24 hours".into());
    }
    if config.brief_model.trim().is_empty() || config.brief_model.len() > 128 {
        return Err("Breve brief model is invalid".into());
    }
    if config.travel.as_ref().is_some_and(|travel| {
        travel.start.len() != 10
            || travel.end.len() != 10
            || travel.start > travel.end
            || travel.tz.trim().is_empty()
            || travel.tz.len() > 96
    }) {
        return Err("Breve travel schedule is invalid".into());
    }
    let valid_model = |model: &str| !model.trim().is_empty() && model.len() <= 128;
    if !valid_model(&config.model_policy.primary)
        || config.model_policy.fallbacks.len() > 16
        || config.model_policy.fallbacks.iter().any(|model| !valid_model(model))
        || config.model_policy.local_helper.as_deref().is_some_and(|model| !valid_model(model))
    {
        return Err("Breve model policy is invalid".into());
    }
    let valid_color = |value: &str| {
        value.len() == 7
            && value.starts_with('#')
            && value.as_bytes()[1..].iter().all(|byte| byte.is_ascii_hexdigit())
    };
    let palette = &config.pdf_theme.custom;
    if [
        &palette.background,
        &palette.surface,
        &palette.text,
        &palette.muted,
        &palette.accent,
        &palette.rule,
    ]
    .into_iter()
    .any(|value| !valid_color(value))
    {
        return Err("Breve PDF colors must use six-digit hex values".into());
    }
    let allowed_ids: HashSet<&str> = ["morning", "lunch", "night", "creators", "watchers", "doctor", "signal"]
        .into_iter()
        .collect();
    if config.routines.len() != 7 {
        return Err("Breve config must contain exactly seven routines".into());
    }
    let mut seen = HashSet::new();
    let allowed_lanes: HashSet<&str> = ["inApp", "signal", "email"].into_iter().collect();
    for routine in &config.routines {
        if !allowed_ids.contains(routine.id.as_str()) || !seen.insert(routine.id.as_str()) {
            return Err(format!("unknown or duplicate Breve routine: {}", routine.id));
        }
        if !matches!(routine.kind.as_str(), "brief" | "creators" | "watchers" | "doctor" | "signal") {
            return Err(format!("invalid Breve routine kind: {}", routine.kind));
        }
        if routine.label.trim().is_empty()
            || routine.label.len() > 96
            || routine.lanes.len() > allowed_lanes.len()
            || routine.lanes.iter().any(|lane| !allowed_lanes.contains(lane.as_str()))
        {
            return Err(format!("invalid Breve routine metadata: {}", routine.id));
        }
        match &routine.schedule {
            BreveSchedule::DailyAt { hhmm, lead_minutes } if valid_hhmm(hhmm) && *lead_minutes <= 24 * 60 => {}
            BreveSchedule::EverySecs { secs } if (60..=604_800).contains(secs) => {}
            BreveSchedule::AlwaysOn => {}
            _ => return Err(format!("invalid schedule for Breve routine: {}", routine.id)),
        }
        let shape_ok = match routine.id.as_str() {
            "morning" | "lunch" | "night" => {
                routine.kind == "brief" && matches!(&routine.schedule, BreveSchedule::DailyAt { .. })
            }
            "creators" => routine.kind == "creators" && matches!(&routine.schedule, BreveSchedule::EverySecs { .. }),
            "watchers" => routine.kind == "watchers" && matches!(&routine.schedule, BreveSchedule::EverySecs { .. }),
            "doctor" => routine.kind == "doctor" && matches!(&routine.schedule, BreveSchedule::EverySecs { .. }),
            "signal" => routine.kind == "signal" && matches!(&routine.schedule, BreveSchedule::AlwaysOn),
            _ => false,
        };
        if !shape_ok {
            return Err(format!("Breve routine has the wrong kind or schedule: {}", routine.id));
        }
    }
    Ok(())
}

fn strip_frontmatter(text: &str) -> &str {
    if !text.starts_with("---\n") && !text.starts_with("---\r\n") {
        return text;
    }
    let normalized = text.replace("\r\n", "\n");
    if let Some(end) = normalized[4..].find("\n---\n") {
        let body_start = 4 + end + 5;
        // This allocation-free branch works for the files this module writes
        // (LF). CRLF foreign notes safely fall back to the original text.
        if !text.contains("\r\n") {
            return &text[body_start..];
        }
    }
    text
}

fn note_document(summary: &str, tags: &str, updated: &str, body: &str) -> String {
    format!("---\nsummary: {summary}\ntags: [{tags}]\nupdated: {updated}\n---\n{}", body.trim_start_matches(['\r', '\n']))
}

fn watchlist_counts(markdown: &str) -> (usize, usize) {
    let mut sections = 0;
    let mut topics = 0;
    for line in markdown.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("## ") {
            if !title.trim().eq_ignore_ascii_case("Brief preferences") {
                sections += 1;
            }
            continue;
        }
        if !trimmed.starts_with('|') {
            continue;
        }
        let cells: Vec<_> = trimmed.trim_matches('|').split('|').map(str::trim).collect();
        let first = cells.first().copied().unwrap_or("").trim_matches('*').trim_matches('`');
        if cells.len() >= 2
            && !first.eq_ignore_ascii_case("watch")
            && !first.is_empty()
            && !cells.iter().all(|c| c.trim_matches(':').chars().all(|ch| ch == '-'))
        {
            topics += 1;
        }
    }
    (sections, topics)
}

fn brief_stem(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".md")?;
    Regex::new(r"^\d{4}-\d{2}-\d{2}(?:-lunch|-night)?$").ok()?.is_match(stem).then(|| stem.to_string())
}

fn brief_from(stem: String, markdown: &str, imported: bool) -> BreveBrief {
    let kind = if stem.ends_with("-lunch") { "lunch" } else if stem.ends_with("-night") { "night" } else { "morning" };
    let title = strip_frontmatter(markdown)
        .lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .unwrap_or("Breve brief")
        .to_string();
    BreveBrief {
        date: stem.chars().take(10).collect(),
        path: imported.then(|| format!("{BRIEFS_DIR}/{stem}.md")),
        stem,
        title,
        kind: kind.into(),
        imported,
    }
}

fn scan_briefs(dir: &Path, imported: bool) -> Vec<BreveBrief> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        let Some(stem) = brief_stem(&name) else { continue };
        let Some(markdown) = read_text(&entry.path()) else { continue };
        out.push(brief_from(stem, &markdown, imported));
    }
    out.sort_by(|a, b| b.stem.cmp(&a.stem));
    out
}

fn known_artifact_name(name: &str) -> bool {
    name.ends_with(".html")
        || name.ends_with(".audio.txt")
        || name.ends_with(".suggestion.json")
        || name.ends_with(".pdf")
        || name.ends_with(".mp3")
        || name.ends_with(".png")
}

fn file_count(dir: &Path) -> usize {
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .count()
}

fn artifact_count(active_root: &Path, legacy: Option<&Path>) -> usize {
    let storage = active_root.join("storage");
    let mut count = ["brevePDFs", "breveAudios", "breveViews", "breveBriefs"]
        .into_iter()
        .map(|dir| file_count(&storage.join(dir)))
        .sum();
    if let Some(legacy) = legacy {
        let imported_dir = storage.join("breveBriefs");
        if let Ok(entries) = fs::read_dir(legacy.join("briefs")) {
            for entry in entries.flatten() {
                let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
                if entry.file_type().is_ok_and(|kind| kind.is_file())
                    && known_artifact_name(&name)
                    && !imported_dir.join(name).is_file()
                {
                    count += 1;
                }
            }
        }
    }
    count
}

fn snapshot_at(active_root: &Path, legacy: Option<&Path>) -> BreveSnapshot {
    let migrated_config = read_json::<BreveConfig>(&active_root.join(CONFIG_FILE));
    let legacy_exists = legacy.is_some_and(Path::is_dir);
    let has_rotli_state = migrated_config.is_some()
        || active_root.join(WATCHLIST_FILE).is_file()
        || active_root.join(IMPORT_REPORT_FILE).is_file();
    let source = if has_rotli_state { BreveSource::Rotli } else if legacy_exists { BreveSource::Legacy } else { BreveSource::Empty };

    let config = migrated_config.unwrap_or_else(|| {
        legacy.filter(|path| path.is_dir()).map(legacy_config).unwrap_or_else(|| default_config(false))
    });
    let watchlist = read_text(&active_root.join(WATCHLIST_FILE))
        .map(|text| strip_frontmatter(&text).to_string())
        .or_else(|| legacy.and_then(|root| read_text(&root.join("watchlist.md"))))
        .unwrap_or_default();
    let creators = read_json::<Vec<BreveCreator>>(&active_root.join(CREATORS_FILE))
        .or_else(|| legacy.and_then(|root| read_json(&root.join("creators.json"))))
        .unwrap_or_default();
    let pages = read_json::<Vec<BrevePage>>(&active_root.join(PAGES_FILE))
        .or_else(|| legacy.and_then(|root| read_json(&root.join("watchers.json"))))
        .unwrap_or_default();

    let mut briefs = scan_briefs(&active_root.join(BRIEFS_DIR), true);
    let mut seen: HashSet<String> = briefs.iter().map(|brief| brief.stem.clone()).collect();
    if let Some(legacy) = legacy {
        for brief in scan_briefs(&legacy.join("briefs"), false) {
            if seen.insert(brief.stem.clone()) {
                briefs.push(brief);
            }
        }
    }
    briefs.sort_by(|a, b| b.stem.cmp(&a.stem));

    let (sections, topics) = watchlist_counts(&watchlist);
    let scheduler = if active_root.join(routines::MANAGED_MARKER).is_file() {
        BreveScheduler::Rotli
    } else if legacy.is_some_and(|root| root.join("launchd").is_dir()) {
        BreveScheduler::LegacyLaunchd
    } else {
        BreveScheduler::None
    };
    BreveSnapshot {
        source,
        legacy_root: legacy.filter(|path| path.is_dir()).map(|path| path.to_string_lossy().to_string()),
        config,
        watchlist,
        counts: BreveCounts { sections, topics, creators: creators.len(), pages: pages.len() },
        creators,
        pages,
        briefs,
        artifact_count: artifact_count(active_root, legacy),
        imported: active_root.join(IMPORT_REPORT_FILE).is_file(),
        scheduler,
    }
}

fn active_root(state: &CorpusState) -> Result<PathBuf, String> {
    state.default_root_path()
}

fn active_memex_write_root(state: &CorpusState) -> Result<PathBuf, String> {
    state.default_breve_memex_write_root()
}

fn string_field(value: &serde_json::Value, name: &str) -> String {
    value.get(name).and_then(|v| v.as_str()).unwrap_or_default().trim().to_string()
}

fn delivery_settings_at(home: &Path, resend_key_configured: bool) -> BreveDeliverySettings {
    let recipients = read_json::<serde_json::Value>(&home.join("recipients.json")).unwrap_or_default();
    let signal = read_json::<serde_json::Value>(&home.join("signal.json")).unwrap_or_default();
    let email_to = match recipients.get("to") {
        Some(serde_json::Value::String(value)) => vec![value.trim().to_string()],
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    };
    BreveDeliverySettings {
        email_from: string_field(&recipients, "from"),
        email_to,
        signal_bot: string_field(&signal, "bot"),
        signal_owner: string_field(&signal, "owner"),
        signal_owner_uuid: string_field(&signal, "ownerUuid"),
        resend_key_configured,
    }
}

fn email_address(value: &str) -> &str {
    let trimmed = value.trim();
    trimmed
        .rsplit_once('<')
        .and_then(|(_, rest)| rest.strip_suffix('>'))
        .unwrap_or(trimmed)
        .trim()
}

fn valid_email(value: &str) -> bool {
    let value = email_address(value);
    value.len() <= 254
        && !value.chars().any(char::is_whitespace)
        && value.split_once('@').is_some_and(|(left, right)| {
            !left.is_empty() && right.contains('.') && !right.starts_with('.') && !right.ends_with('.')
        })
}

fn valid_phone(value: &str) -> bool {
    let bytes = value.as_bytes();
    (9..=16).contains(&bytes.len())
        && bytes.first() == Some(&b'+')
        && bytes.get(1).is_some_and(u8::is_ascii_digit)
        && bytes[1] != b'0'
        && bytes[1..].iter().all(u8::is_ascii_digit)
}

fn validate_delivery_settings(settings: &BreveDeliverySettings) -> Result<(), String> {
    if (!settings.email_from.is_empty() && !valid_email(&settings.email_from))
        || settings.email_from.len() > 320
    {
        return Err("Enter a valid Resend sender address".into());
    }
    if settings.email_to.len() > 20
        || settings.email_to.iter().any(|value| !valid_email(value))
    {
        return Err("Enter valid recipient email addresses".into());
    }
    for (label, value) in [
        ("Signal bot", settings.signal_bot.as_str()),
        ("Signal owner", settings.signal_owner.as_str()),
    ] {
        if !value.is_empty() && !valid_phone(value) {
            return Err(format!("{label} must use E.164 format, such as +14075551234"));
        }
    }
    if settings.signal_owner_uuid.len() > 128
        || settings.signal_owner_uuid.chars().any(|c| c.is_control())
    {
        return Err("Signal owner UUID is invalid".into());
    }
    Ok(())
}

/// Move only the Resend credential from the retired Breve keychain into
/// Rotli's allowlisted login-keychain entry. The value never crosses IPC.
fn migrate_resend_key(home: &Path) -> bool {
    const NAME: &str = "breve-resend-api-key";
    if keychain::get_secret(NAME).is_some() {
        return true;
    }
    let output = Command::new(find_bun())
        .arg(home.join("scripts/secret.ts"))
        .args(["get", "resend-breve"])
        .current_dir(home)
        .env("ROTLI_BREVE_HOME", home)
        .stderr(Stdio::null())
        .output();
    let Ok(output) = output else { return false };
    if !output.status.success() {
        return false;
    }
    let Ok(value) = String::from_utf8(output.stdout) else { return false };
    if keychain::store_secret(NAME, value.trim()).is_err() {
        return false;
    }
    let _ = Command::new(find_bun())
        .arg(home.join("scripts/secret.ts"))
        .args(["delete", "resend-breve"])
        .current_dir(home)
        .env("ROTLI_BREVE_HOME", home)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    true
}

#[tauri::command]
pub fn breve_delivery_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
) -> Result<BreveDeliverySettings, String> {
    if cfg!(debug_assertions) {
        return Ok(dev_delivery_settings(&app));
    }
    let root = active_root(&state)?;
    let home = root.join(routines::MANAGED_DIR);
    let configured = migrate_resend_key(&home);
    Ok(delivery_settings_at(&home, configured))
}

#[tauri::command]
pub fn breve_write_delivery_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    mut settings: BreveDeliverySettings,
) -> Result<BreveDeliverySettings, String> {
    settings.email_from = settings.email_from.trim().to_string();
    settings.email_to = settings
        .email_to
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    settings.signal_bot = settings.signal_bot.trim().to_string();
    settings.signal_owner = settings.signal_owner.trim().to_string();
    settings.signal_owner_uuid = settings.signal_owner_uuid.trim().to_string();
    validate_delivery_settings(&settings)?;
    if cfg!(debug_assertions) {
        settings.resend_key_configured = DEV_RESEND_CONFIGURED.load(Ordering::SeqCst);
        let state = DEV_DELIVERY_SETTINGS.get_or_init(|| Mutex::new(settings.clone()));
        *state.lock().map_err(|_| "dev delivery settings lock poisoned")? = settings.clone();
        return Ok(settings);
    }
    let root = active_memex_write_root(&state)?;
    let home = root.join(routines::MANAGED_DIR);
    let before = delivery_settings_at(&home, keychain::get_secret("breve-resend-api-key").is_some());
    let signal_changed = before.signal_bot != settings.signal_bot
        || before.signal_owner != settings.signal_owner
        || before.signal_owner_uuid != settings.signal_owner_uuid;
    write_json(
        &home.join("recipients.json"),
        &serde_json::json!({
            "from": settings.email_from,
            "to": settings.email_to,
            "_notes": "Managed by Rotli → Breve → Configure. The Resend API key stays in the macOS Keychain."
        }),
    )?;
    write_json(
        &home.join("signal.json"),
        &serde_json::json!({
            "bot": settings.signal_bot,
            "owner": settings.signal_owner,
            "ownerUuid": settings.signal_owner_uuid,
            "_notes": "Managed by Rotli → Breve → Configure. Numbers use E.164 format."
        }),
    )?;
    settings.resend_key_configured = keychain::get_secret("breve-resend-api-key").is_some();
    // signal-daemon reads its identity allowlist once at process start. A saved
    // identity change therefore restarts Rotli's one supervisor so the new
    // values take effect immediately, without creating any launchd jobs.
    if signal_changed && root.join(routines::MANAGED_MARKER).is_file() {
        let supervisor = app.state::<BreveSupervisor>();
        supervisor.stop();
        supervisor.start(&app, root)?;
    }
    Ok(settings)
}

#[tauri::command]
pub fn breve_store_resend_key(value: String) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("the key is empty".into());
    }
    if cfg!(debug_assertions) {
        DEV_RESEND_CONFIGURED.store(true, Ordering::SeqCst);
        return Ok(());
    }
    keychain::store_secret("breve-resend-api-key", value)
}

#[tauri::command]
pub fn breve_remove_resend_key() -> Result<(), String> {
    if cfg!(debug_assertions) {
        DEV_RESEND_CONFIGURED.store(false, Ordering::SeqCst);
        return Ok(());
    }
    keychain::delete_secret("breve-resend-api-key")
}

#[tauri::command]
pub fn breve_test_email(state: tauri::State<'_, CorpusState>) -> Result<String, String> {
    if cfg!(debug_assertions) {
        return Ok("Test email simulated in Tauri dev mode".into());
    }
    let root = active_root(&state)?;
    let home = root.join(routines::MANAGED_DIR);
    let settings = delivery_settings_at(&home, keychain::get_secret("breve-resend-api-key").is_some());
    validate_delivery_settings(&settings)?;
    let key = keychain::get_secret("breve-resend-api-key").ok_or("Add a Resend API key first")?;
    if settings.email_from.is_empty() || settings.email_to.is_empty() {
        return Err("Add a sender and at least one recipient first".into());
    }
    let authorization = format!("Bearer {key}");
    let result = ureq::post("https://api.resend.com/emails")
        .timeout(Duration::from_secs(30))
        .set("Authorization", &authorization)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({
            "from": settings.email_from,
            "to": settings.email_to,
            "subject": "Rotli delivery test",
            "text": "Your Breve email delivery is configured and working through Rotli."
        }));
    match result {
        Ok(_) => Ok("Test email sent".into()),
        Err(ureq::Error::Status(code, response)) => {
            let detail = response.into_string().unwrap_or_default();
            Err(format!("Resend rejected the test ({code}): {}", detail.chars().take(240).collect::<String>()))
        }
        Err(error) => Err(format!("Could not reach Resend: {error}")),
    }
}

#[tauri::command]
pub fn breve_test_signal(state: tauri::State<'_, CorpusState>) -> Result<String, String> {
    if cfg!(debug_assertions) {
        return Ok("Test Signal simulated in Tauri dev mode".into());
    }
    let root = active_root(&state)?;
    let home = root.join(routines::MANAGED_DIR);
    let settings = delivery_settings_at(&home, keychain::get_secret("breve-resend-api-key").is_some());
    validate_delivery_settings(&settings)?;
    if settings.signal_bot.is_empty() || settings.signal_owner.is_empty() {
        return Err("Add the Signal bot and owner numbers first".into());
    }
    let user_home = std::env::var("HOME").unwrap_or_default();
    let inherited_path = std::env::var("PATH").unwrap_or_default();
    let runtime_path = format!(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{user_home}/.bun/bin:{user_home}/.local/bin:{inherited_path}"
    );
    let output = Command::new(find_bun())
        .arg(home.join("scripts/send-signal-text.ts"))
        .args(["--message", "Rotli delivery test — Signal is configured and working."])
        .current_dir(&home)
        .env("ROTLI_BREVE_HOME", &home)
        .env("PATH", runtime_path)
        .output()
        .map_err(|error| format!("Could not start the Signal test: {error}"))?;
    if output.status.success() {
        Ok("Test Signal sent".into())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr);
        Err(format!("Signal test failed: {}", detail.chars().take(240).collect::<String>()))
    }
}

#[tauri::command]
pub fn breve_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
) -> Result<BreveSnapshot, String> {
    if cfg!(debug_assertions) {
        return Ok(dev_breve_snapshot(&app));
    }
    let root = active_root(&state)?;
    let legacy = legacy_root();
    Ok(snapshot_at(&root, legacy.as_deref()))
}

#[tauri::command]
pub fn breve_write_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    config: BreveConfig,
) -> Result<BreveSnapshot, String> {
    validate_config(&config)?;
    if cfg!(debug_assertions) {
        let mut snapshot = dev_breve_snapshot(&app);
        snapshot.config = config;
        return Ok(snapshot);
    }
    let root = active_root(&state)?;
    write_json(&root.join(CONFIG_FILE), &config)?;
    let legacy = legacy_root();
    Ok(snapshot_at(&root, legacy.as_deref()))
}

#[tauri::command]
pub fn breve_write_watchlist(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    markdown: String,
) -> Result<BreveSnapshot, String> {
    if markdown.len() as u64 > MAX_TEXT_BYTES || markdown.contains('\0') {
        return Err("Breve watchlist is too large or contains invalid bytes".into());
    }
    if cfg!(debug_assertions) {
        set_dev_watchlist(&app, markdown);
        return Ok(dev_breve_snapshot(&app));
    }
    let root = active_memex_write_root(&state)?;
    let path = root.join(WATCHLIST_FILE);
    let body = strip_frontmatter(&markdown);
    let doc = if let Some(existing) = read_text(&path) {
        if existing.starts_with("---\n") {
            let front_end = existing[4..].find("\n---\n").map(|at| at + 9);
            front_end
                .map(|end| format!("{}{}", &existing[..end], body.trim_start_matches(['\r', '\n'])))
                .unwrap_or_else(|| note_document("Breve watchlist topics and lenses", "breve, watchlist", &now_date(), body))
        } else {
            note_document("Breve watchlist topics and lenses", "breve, watchlist", &now_date(), body)
        }
    } else {
        note_document("Breve watchlist topics and lenses", "breve, watchlist", &now_date(), body)
    };
    write_atomic(&path, doc.as_bytes())?;
    let legacy = legacy_root();
    Ok(snapshot_at(&root, legacy.as_deref()))
}

fn copy_brief_notes(legacy: &Path, active_root: &Path) -> Result<usize, String> {
    let source = legacy.join("briefs");
    let target = active_root.join(BRIEFS_DIR);
    fs::create_dir_all(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
    let mut copied = 0;
    let Ok(entries) = fs::read_dir(source) else { return Ok(0) };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        let Some(stem) = brief_stem(&name) else { continue };
        let dst = target.join(&name);
        if dst.exists() {
            continue;
        }
        let Some(markdown) = read_text(&entry.path()) else { continue };
        let kind = if stem.ends_with("-lunch") { "lunch" } else if stem.ends_with("-night") { "night" } else { "morning" };
        let date: String = stem.chars().take(10).collect();
        let doc = note_document(
            &format!("Breve {kind} brief for {date}"),
            &format!("breve, brief, {kind}"),
            &date,
            &markdown,
        );
        write_atomic(&dst, doc.as_bytes())?;
        copied += 1;
    }
    Ok(copied)
}

fn copy_brief_artifacts(legacy: &Path, active_root: &Path) -> Result<usize, String> {
    let source = legacy.join("briefs");
    let target = active_root.join(BRIEF_ARTIFACTS_DIR);
    fs::create_dir_all(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
    let mut copied = 0;
    let Ok(entries) = fs::read_dir(source) else { return Ok(0) };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        if !known_artifact_name(&name) {
            continue;
        }
        let dst = target.join(&name);
        if dst.exists() {
            continue;
        }
        fs::copy(entry.path(), &dst).map_err(|e| format!("copy {}: {e}", name))?;
        copied += 1;
    }
    Ok(copied)
}

fn import_legacy_at(root: &Path, legacy: &Path) -> Result<BreveSnapshot, String> {
    if !legacy.is_dir() {
        return Err(format!("legacy Breve was not found at {}", legacy.display()));
    }
    fs::create_dir_all(root.join(ROUTINES_DIR))
        .map_err(|e| format!("create {}: {e}", root.join(ROUTINES_DIR).display()))?;

    let config_path = root.join(CONFIG_FILE);
    let config_written = if config_path.exists() {
        false
    } else {
        let config = legacy_config(legacy);
        validate_config(&config)?;
        write_json(&config_path, &config)?;
        true
    };

    let watchlist_path = root.join(WATCHLIST_FILE);
    let watchlist_written = if watchlist_path.exists() {
        false
    } else if let Some(markdown) = read_text(&legacy.join("watchlist.md")) {
        let doc = note_document(
            "Breve watchlist topics and lenses",
            "breve, watchlist",
            &now_date(),
            strip_frontmatter(&markdown),
        );
        write_atomic(&watchlist_path, doc.as_bytes())?;
        true
    } else {
        false
    };

    let creators_path = root.join(CREATORS_FILE);
    let creators_written = if creators_path.exists() {
        false
    } else if let Some(creators) = read_json::<Vec<BreveCreator>>(&legacy.join("creators.json")) {
        write_json(&creators_path, &creators)?;
        true
    } else {
        false
    };
    let pages_path = root.join(PAGES_FILE);
    let pages_written = if pages_path.exists() {
        false
    } else if let Some(pages) = read_json::<Vec<BrevePage>>(&legacy.join("watchers.json")) {
        write_json(&pages_path, &pages)?;
        true
    } else {
        false
    };

    let briefs_copied = copy_brief_notes(legacy, root)?;
    let brief_artifacts_copied = copy_brief_artifacts(legacy, root)?;
    let report = ImportReport {
        version: 1,
        imported_at: now_stamp(),
        source: legacy.to_string_lossy().to_string(),
        config_written,
        watchlist_written,
        creators_written,
        pages_written,
        briefs_copied,
        brief_artifacts_copied,
    };
    write_json(&root.join(IMPORT_REPORT_FILE), &report)?;
    Ok(snapshot_at(root, Some(legacy)))
}

#[tauri::command]
pub fn breve_import_legacy(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
) -> Result<BreveSnapshot, String> {
    if cfg!(debug_assertions) {
        return Ok(dev_breve_snapshot(&app));
    }
    let root = active_memex_write_root(&state)?;
    let legacy = legacy_root().ok_or("HOME is unavailable; legacy Breve cannot be located")?;
    import_legacy_at(&root, &legacy)
}

fn copy_if_present(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_file() || target.exists() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|e| format!("copy {} to {}: {e}", source.display(), target.display()))
}

#[cfg(unix)]
fn replace_with_alias(path: &Path, target: &Path) -> Result<(), String> {
    use std::os::unix::fs::symlink;
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Ok(());
    }
    if path.is_dir() {
        let empty = fs::read_dir(path).map(|mut entries| entries.next().is_none()).unwrap_or(false);
        if !empty {
            return Err(format!("refusing to replace non-empty managed path {}", path.display()));
        }
        fs::remove_dir(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    symlink(target, path).map_err(|e| format!("link {} to {}: {e}", path.display(), target.display()))
}

#[cfg(not(unix))]
fn replace_with_alias(_path: &Path, _target: &Path) -> Result<(), String> {
    Err("Breve takeover currently requires filesystem aliases".into())
}

fn migrate_private_runtime(legacy: &Path, home: &Path, root: &Path) -> Result<(), String> {
    for name in [
        "config.local.json",
        "signal.json",
        "recipients.json",
        "mail-accounts.json",
        "access.json",
        "policy.json",
        "capabilities.json",
        "pronunciation.json",
    ] {
        copy_if_present(&legacy.join(name), &home.join(name))?;
    }
    for dir in ["signal", "logs"] {
        if legacy.join(dir).is_dir() {
            routines::copy_tree(&legacy.join(dir), &home.join(dir), false)?;
        }
    }

    let canonical_briefs = root.join(BRIEFS_DIR);
    let canonical_watchlist = root.join(WATCHLIST_FILE);
    let canonical_creators = root.join(CREATORS_FILE);
    let canonical_pages = root.join(PAGES_FILE);
    fs::create_dir_all(&canonical_briefs).map_err(|e| format!("create {}: {e}", canonical_briefs.display()))?;
    replace_with_alias(&home.join("briefs"), &canonical_briefs)?;
    replace_with_alias(&home.join("watchlist.md"), &canonical_watchlist)?;
    replace_with_alias(&home.join("creators.json"), &canonical_creators)?;
    replace_with_alias(&home.join("watchers.json"), &canonical_pages)?;
    Ok(())
}

fn disable_legacy_agents(home: &Path) -> Result<(), String> {
    let Some(user_home) = std::env::var_os("HOME").map(PathBuf::from) else { return Ok(()) };
    let agents = user_home.join("Library/LaunchAgents");
    let backup = home.join("legacy-launchd");
    fs::create_dir_all(&backup).map_err(|e| format!("create {}: {e}", backup.display()))?;
    let Ok(entries) = fs::read_dir(&agents) else { return Ok(()) };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.contains("breve") || !name.ends_with(".plist") || !entry.path().is_file() {
            continue;
        }
        fs::copy(entry.path(), backup.join(&name))
            .map_err(|e| format!("back up legacy agent {name}: {e}"))?;
        let _ = std::process::Command::new("launchctl").arg("unload").arg(entry.path()).status();
        fs::remove_file(entry.path()).map_err(|e| format!("remove legacy agent {name}: {e}"))?;
    }
    Ok(())
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// One Rotli login item replaces seven Breve agents. It launches the menu-bar
/// app after login; the app then owns the scheduler and Signal children.
pub(crate) fn install_rotli_login_agent() -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("HOME is unavailable")?;
    let executable = std::env::current_exe().map_err(|e| format!("resolve Rotli executable: {e}"))?;
    let agents = home.join("Library/LaunchAgents");
    fs::create_dir_all(&agents).map_err(|e| format!("create {}: {e}", agents.display()))?;
    let plist = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n  <key>Label</key><string>com.rotli.app.background</string>\n  <key>ProgramArguments</key><array><string>{}</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>ProcessType</key><string>Background</string>\n</dict></plist>\n",
        xml_escape(&executable.to_string_lossy()),
    );
    write_atomic(&agents.join("com.rotli.app.background.plist"), plist.as_bytes())
}

fn initialize_scheduler_state(root: &Path, home: &Path) -> Result<(), String> {
    let mut jobs = serde_json::Map::new();
    let briefs = scan_briefs(&root.join(BRIEFS_DIR), true);
    for id in ["morning", "lunch", "night"] {
        if let Some(brief) = briefs.iter().find(|brief| brief.kind == id) {
            jobs.insert(
                id.into(),
                serde_json::json!({ "lastStarted": now_stamp(), "lastSlot": brief.date, "lastOk": true }),
            );
        }
    }
    for id in ["creators", "watchers", "doctor"] {
        jobs.insert(id.into(), serde_json::json!({ "lastStarted": now_stamp(), "lastOk": true }));
    }
    let path = home.join("scheduler-state.json");
    if !path.exists() {
        write_json(&path, &serde_json::json!({ "version": 1, "jobs": jobs }))?;
    }
    Ok(())
}

/// Complete the copy-only import, relocate private runtime state, disable the
/// seven legacy jobs, and only then mark/start Rotli ownership.
#[tauri::command]
pub fn breve_takeover(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
) -> Result<BreveSnapshot, String> {
    if cfg!(debug_assertions) {
        return Ok(dev_breve_snapshot(&app));
    }
    let root = active_memex_write_root(&state)?;
    let legacy = legacy_root().ok_or("HOME is unavailable; legacy Breve cannot be located")?;
    if !legacy.is_dir() {
        return Err(format!("legacy Breve was not found at {}", legacy.display()));
    }
    import_legacy_at(&root, &legacy)?;
    if let Some(mut config) = read_json::<BreveConfig>(&root.join(CONFIG_FILE)) {
        if config.travel.is_none() {
            config.travel = legacy_config(&legacy).travel;
            validate_config(&config)?;
            write_json(&root.join(CONFIG_FILE), &config)?;
        }
    }
    let home = routines::sync_runtime(&app, &root)?;
    migrate_private_runtime(&legacy, &home, &root)?;
    initialize_scheduler_state(&root, &home)?;
    disable_legacy_agents(&home)?;
    install_rotli_login_agent()?;
    write_json(
        &root.join(routines::MANAGED_MARKER),
        &ManagedMarker { version: 1, taken_over_at: now_stamp(), legacy_root: Some(legacy.to_string_lossy().to_string()) },
    )?;
    app.state::<BreveSupervisor>().start(&app, root.clone())?;
    Ok(snapshot_at(&root, Some(&legacy)))
}

fn legacy_agents_remaining() -> bool {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return false };
    fs::read_dir(home.join("Library/LaunchAgents"))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.contains("breve") && name.ends_with(".plist")
        })
}

/// Final, recoverable retirement: only after Rotli is live and the required
/// private/runtime data is present, move ~/breve to the macOS Trash.
#[tauri::command]
pub fn breve_retire_legacy(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
) -> Result<BreveSnapshot, String> {
    if cfg!(debug_assertions) {
        return Ok(dev_breve_snapshot(&app));
    }
    let root = active_memex_write_root(&state)?;
    let legacy = legacy_root().ok_or("HOME is unavailable; legacy Breve cannot be located")?;
    let home = root.join(routines::MANAGED_DIR);
    if !root.join(routines::MANAGED_MARKER).is_file()
        || !app.state::<BreveSupervisor>().running()
        || !home.join("scheduler-state.json").is_file()
    {
        return Err("Rotli's Breve scheduler is not yet verified running".into());
    }
    for name in ["signal.json", "config.local.json"] {
        if legacy.join(name).is_file() && !home.join(name).is_file() {
            return Err(format!("managed Breve is missing {name}; legacy project was kept"));
        }
    }
    if legacy_agents_remaining() {
        return Err("legacy Breve launchd jobs still exist; legacy project was kept".into());
    }
    trash::delete(&legacy).map_err(|e| format!("move legacy Breve to Trash: {e}"))?;
    // Once takeover has been verified, Breve is a Rotli feature—not a preserved
    // standalone project. Drop migration-only backups and scrub the old root.
    let _ = fs::remove_dir_all(home.join("legacy-launchd"));
    let _ = fs::remove_file(root.join(IMPORT_REPORT_FILE));
    if let Some(mut marker) = read_json::<ManagedMarker>(&root.join(routines::MANAGED_MARKER)) {
        marker.legacy_root = None;
        let _ = write_json(&root.join(routines::MANAGED_MARKER), &marker);
    }
    Ok(snapshot_at(&root, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn delivery_settings_accept_resend_and_e164_shapes() {
        let settings = BreveDeliverySettings {
            email_from: "Breve <briefs@example.com>".into(),
            email_to: vec!["owner@example.com".into()],
            signal_bot: "+14075550101".into(),
            signal_owner: "+14075550102".into(),
            signal_owner_uuid: "00000000-0000-0000-0000-000000000000".into(),
            resend_key_configured: true,
        };
        assert!(validate_delivery_settings(&settings).is_ok());

        let mut invalid = settings.clone();
        invalid.signal_owner = "407-555-0102".into();
        assert!(validate_delivery_settings(&invalid).is_err());
        invalid = settings;
        invalid.email_to = vec!["not-an-email".into()];
        assert!(validate_delivery_settings(&invalid).is_err());
    }

    #[test]
    fn delivery_settings_read_legacy_string_or_recipient_array() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("recipients.json"), r#"{"from":"briefs@example.com","to":"one@example.com"}"#).unwrap();
        fs::write(dir.path().join("signal.json"), r#"{"bot":"+14075550101","owner":"+14075550102"}"#).unwrap();
        let one = delivery_settings_at(dir.path(), false);
        assert_eq!(one.email_to, vec!["one@example.com"]);
        assert_eq!(one.signal_bot, "+14075550101");

        fs::write(dir.path().join("recipients.json"), r#"{"from":"briefs@example.com","to":["one@example.com","two@example.com"]}"#).unwrap();
        let two = delivery_settings_at(dir.path(), true);
        assert_eq!(two.email_to, vec!["one@example.com", "two@example.com"]);
        assert!(two.resend_key_configured);
    }

    #[test]
    fn parses_the_live_watchlist_shape() {
        let md = "# Breve Watchlist\n\n## Tools\n\n| Watch | Lens |\n|---|---|\n| **Bun** | releases |\n| `Vite` | open source |\n\n## Brief preferences\n\n- short\n";
        assert_eq!(watchlist_counts(md), (1, 2));
    }

    #[test]
    fn legacy_config_builds_exactly_seven_routines() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("settings.json"),
            r#"{"timezone":"UTC","leadMinutes":45,"leadOverrides":{"morning":90},"deliveryTimes":{"morning":"08:00","lunch":"13:00","night":"19:00"},"briefModel":"haiku"}"#,
        )
        .unwrap();
        let config = legacy_config(dir.path());
        assert_eq!(config.routines.len(), 7);
        assert_eq!(config.timezone, "UTC");
        assert_eq!(config.model_policy.primary, "haiku");
        assert_eq!(config.routines[0].schedule, BreveSchedule::DailyAt { hhmm: "08:00".into(), lead_minutes: 90 });
        validate_config(&config).unwrap();
    }

    #[test]
    fn schedule_wire_shape_matches_the_typescript_contract() {
        let value = serde_json::to_value(BreveSchedule::DailyAt {
            hhmm: "07:00".into(),
            lead_minutes: 60,
        })
        .unwrap();
        assert_eq!(value, serde_json::json!({ "kind": "dailyAt", "hhmm": "07:00", "leadMinutes": 60 }));
    }

    #[test]
    fn snapshot_prefers_rotli_state_but_keeps_new_legacy_briefs_visible() {
        let active = tempdir().unwrap();
        let legacy = tempdir().unwrap();
        fs::create_dir_all(active.path().join(ROUTINES_DIR)).unwrap();
        fs::create_dir_all(active.path().join(BRIEFS_DIR)).unwrap();
        fs::create_dir_all(legacy.path().join("briefs")).unwrap();
        write_json(&active.path().join(CONFIG_FILE), &default_config(true)).unwrap();
        fs::write(
            active.path().join(BRIEFS_DIR).join("2026-07-08.md"),
            note_document("x", "breve, brief", "2026-07-08", "# Imported"),
        )
        .unwrap();
        fs::write(legacy.path().join("briefs/2026-07-09.md"), "# Legacy").unwrap();
        let snapshot = snapshot_at(active.path(), Some(legacy.path()));
        assert_eq!(snapshot.source, BreveSource::Rotli);
        assert_eq!(snapshot.briefs.len(), 2);
        assert!(snapshot.briefs.iter().any(|brief| brief.imported));
        assert!(snapshot.briefs.iter().any(|brief| !brief.imported));
    }

    #[test]
    fn brief_copy_is_idempotent_and_keeps_body() {
        let active = tempdir().unwrap();
        let legacy = tempdir().unwrap();
        fs::create_dir_all(legacy.path().join("briefs")).unwrap();
        fs::write(legacy.path().join("briefs/2026-07-09-lunch.md"), "# Pivot\n\nBody.\n").unwrap();
        assert_eq!(copy_brief_notes(legacy.path(), active.path()).unwrap(), 1);
        assert_eq!(copy_brief_notes(legacy.path(), active.path()).unwrap(), 0);
        let imported = fs::read_to_string(active.path().join(BRIEFS_DIR).join("2026-07-09-lunch.md")).unwrap();
        assert!(imported.contains("summary: Breve lunch brief for 2026-07-09"));
        assert!(imported.ends_with("# Pivot\n\nBody.\n"));
    }

    #[test]
    fn full_import_is_copy_only_and_idempotent() {
        let active = tempdir().unwrap();
        let legacy = tempdir().unwrap();
        fs::create_dir_all(legacy.path().join("briefs")).unwrap();
        fs::write(legacy.path().join("settings.json"), r#"{"timezone":"UTC"}"#).unwrap();
        fs::write(
            legacy.path().join("watchlist.md"),
            "# Watchlist\n\n## Tools\n\n| Watch | Lens |\n|---|---|\n| Bun | releases |\n",
        )
        .unwrap();
        fs::write(legacy.path().join("creators.json"), "[]\n").unwrap();
        fs::write(legacy.path().join("watchers.json"), "[]\n").unwrap();
        fs::write(legacy.path().join("briefs/2026-07-09.md"), "# Morning\n\nBody.\n").unwrap();
        fs::write(legacy.path().join("briefs/2026-07-09.html"), "<h1>Morning</h1>\n").unwrap();

        let first = import_legacy_at(active.path(), legacy.path()).unwrap();
        assert!(first.imported);
        assert_eq!(first.briefs.len(), 1);
        assert_eq!(first.artifact_count, 1);
        assert_eq!(fs::read_to_string(legacy.path().join("briefs/2026-07-09.md")).unwrap(), "# Morning\n\nBody.\n");

        let imported_before = fs::read(active.path().join(BRIEFS_DIR).join("2026-07-09.md")).unwrap();
        let second = import_legacy_at(active.path(), legacy.path()).unwrap();
        assert_eq!(second.briefs.len(), 1);
        assert_eq!(fs::read(active.path().join(BRIEFS_DIR).join("2026-07-09.md")).unwrap(), imported_before);
    }

    #[test]
    fn config_refuses_missing_or_duplicate_routines() {
        let mut config = default_config(true);
        config.routines.pop();
        assert!(validate_config(&config).is_err());
        config = default_config(true);
        config.routines[1].id = "morning".into();
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn config_validates_custom_pdf_colors() {
        let mut config = default_config(true);
        config.pdf_theme.preset = BrevePdfThemePreset::Custom;
        config.pdf_theme.custom.background = "#102030".into();
        assert!(validate_config(&config).is_ok());
        config.pdf_theme.custom.accent = "amber".into();
        assert!(validate_config(&config).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn private_runtime_moves_and_canonical_files_stay_single_source() {
        let legacy = tempdir().unwrap();
        let active = tempdir().unwrap();
        let home = active.path().join(routines::MANAGED_DIR);
        fs::create_dir_all(legacy.path().join("signal/transcripts")).unwrap();
        fs::create_dir_all(legacy.path().join("logs")).unwrap();
        fs::create_dir_all(&home).unwrap();
        fs::write(legacy.path().join("signal.json"), "{\"bot\":\"x\"}").unwrap();
        fs::write(legacy.path().join("signal/transcripts/day.log"), "hello").unwrap();
        fs::write(legacy.path().join("logs/.doctor-state.json"), "{}").unwrap();
        fs::create_dir_all(active.path().join(BRIEFS_DIR)).unwrap();
        fs::create_dir_all(active.path().join(ROUTINES_DIR)).unwrap();
        fs::create_dir_all(active.path().join("wiki/reference")).unwrap();
        fs::write(active.path().join(WATCHLIST_FILE), "# Watch").unwrap();
        fs::write(active.path().join(CREATORS_FILE), "[]").unwrap();
        fs::write(active.path().join(PAGES_FILE), "[]").unwrap();
        fs::create_dir_all(home.join("briefs")).unwrap();

        migrate_private_runtime(legacy.path(), &home, active.path()).unwrap();

        assert_eq!(fs::read_to_string(home.join("signal.json")).unwrap(), "{\"bot\":\"x\"}");
        assert_eq!(fs::read_to_string(home.join("signal/transcripts/day.log")).unwrap(), "hello");
        assert_eq!(fs::read_to_string(home.join("watchlist.md")).unwrap(), "# Watch");
        assert!(fs::symlink_metadata(home.join("watchlist.md")).unwrap().file_type().is_symlink());
        assert!(fs::symlink_metadata(home.join("briefs")).unwrap().file_type().is_symlink());
    }

    #[test]
    fn managed_marker_switches_the_reported_scheduler() {
        let active = tempdir().unwrap();
        fs::create_dir_all(active.path().join(ROUTINES_DIR)).unwrap();
        write_json(&active.path().join(CONFIG_FILE), &default_config(true)).unwrap();
        write_json(
            &active.path().join(routines::MANAGED_MARKER),
            &ManagedMarker { version: 1, taken_over_at: "now".into(), legacy_root: None },
        )
        .unwrap();
        assert_eq!(snapshot_at(active.path(), None).scheduler, BreveScheduler::Rotli);
    }
}
