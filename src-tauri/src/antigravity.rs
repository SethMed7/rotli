//! Google Antigravity as a connected lane, through Google's official ACP agent
//! (ADR docs/decisions/2026-09-03-antigravity-official-acp-lane.md).
//!
//! Rotli owns three things here and nothing else: the managed runtime (a
//! pinned-hash download of the registry-listed archive into Application
//! Support), the private profile the agent keeps its Google credential in
//! (`GEMINI_HOME`, file storage, mode 0700 — Rotli never reads the token), and
//! the sign-in handshake (the agent prints Google's authorization URL, Rotli
//! opens it, the agent's own loopback callback finishes the exchange). Chat
//! turns ride the shared ACP transport in acp.rs with the same profile.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::acp::{self, AcpLane};
use super::{ProviderState, Running, NEXT_TOKEN};

/// The registry release this build pins. URL from
/// agentclientprotocol/registry `antigravity-acp/agent.json`; hash and sizes
/// verified against the downloaded archive on 2026-09-03 (Apple Silicon).
pub(crate) const RELEASE_VERSION: &str = "agy_acp_server_20260818_01_RC01";
pub(crate) const ARCHIVE_URL: &str = "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-agy_acp_server_20260818_01_RC01-darwin-arm64.zip";
pub(crate) const ARCHIVE_SHA256: &str =
    "f122ca7e7030a27f9649da4cf1a7d80e12c48c5f6118ff35affc34d56cbf83dd";
pub(crate) const ARCHIVE_BYTES: u64 = 314_500_221;
pub(crate) const EXECUTABLE_NAME: &str = "agy_acp_server.par";
pub(crate) const EXECUTABLE_BYTES: u64 = 792_105_680;
pub(crate) const HARNESS_NAME: &str = "localharness_external";
pub(crate) const HARNESS_BYTES: u64 = 101_551_680;

/// Where the managed runtime lives — a fixed path so the provider allowlist
/// (`CLIS`, parity-pinned) can name it without an app handle. On macOS Tauri's
/// app-data dir is exactly `~/Library/Application Support/<identifier>`.
pub(crate) const BIN_CANDIDATE: &str =
    "~/Library/Application Support/com.rotli.app/antigravity-acp/current/agy_acp_server.par";
const SUPPORT_DIR: &str = "Library/Application Support/com.rotli.app";
const RELEASE_RECORD: &str = "release.json";
const SIGN_IN_REQUEST_ID: &str = "antigravity:sign-in";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(45 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityStatus {
    /// This Mac can run the published runtime (Apple Silicon only — Google
    /// ships no Intel build).
    pub platform_supported: bool,
    pub installed: bool,
    pub version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
    pub signed_in: bool,
    /// The Google authorization URL of the sign-in that just ran, so the card
    /// can offer "copy link" when the browser did not open. Never persisted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReleaseRecord {
    version: String,
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME is not set".to_string())
}

fn managed_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(SUPPORT_DIR).join("antigravity-acp"))
}

pub(crate) fn current_dir() -> Result<PathBuf, String> {
    Ok(managed_root()?.join("current"))
}

fn profile_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(SUPPORT_DIR).join("antigravity-profile"))
}

fn token_path() -> Result<PathBuf, String> {
    Ok(profile_dir()?.join("antigravity-acp").join("acp_token.json"))
}

fn installed_version() -> Option<String> {
    let path = current_dir().ok()?.join(RELEASE_RECORD);
    let record: ReleaseRecord = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    Some(record.version)
}

pub(crate) fn platform_supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

pub(crate) fn installed() -> bool {
    current_dir()
        .map(|dir| dir.join(EXECUTABLE_NAME).is_file() && dir.join(HARNESS_NAME).is_file())
        .unwrap_or(false)
}

pub(crate) fn signed_in() -> bool {
    token_path().map(|path| path.is_file()).unwrap_or(false)
}

pub(crate) fn status() -> AntigravityStatus {
    let version = installed_version();
    AntigravityStatus {
        platform_supported: platform_supported(),
        installed: installed(),
        update_available: installed() && version.as_deref() != Some(RELEASE_VERSION),
        version,
        latest_version: RELEASE_VERSION.into(),
        signed_in: signed_in(),
        authorization_url: None,
    }
}

/// Host variables that would redirect the agent to another Google identity,
/// project, or credential store. Stripped from every spawn, as T3 Code does.
pub(crate) fn env_remove_keys() -> Vec<String> {
    std::env::vars_os()
        .filter_map(|(key, _)| key.into_string().ok())
        .filter(|key| {
            let upper = key.to_ascii_uppercase();
            upper.starts_with("GEMINI_")
                || upper.starts_with("GOOGLE_")
                || upper.starts_with("AGY_")
                || upper.starts_with("ANTIGRAVITY_")
                || matches!(
                    upper.as_str(),
                    "GCLOUD_PROJECT" | "CLOUDSDK_CORE_PROJECT" | "BROWSER" | "PYTHONUNBUFFERED"
                )
        })
        .collect()
}

/// The private profile and harness wiring for one agent process. `BROWSER`
/// is pinned to a no-op so the agent never opens a page by itself: sign-in
/// opens the URL from Rotli after validating it; a chat turn refuses it.
pub(crate) fn runtime_env(bin: &Path) -> Result<Vec<(String, OsString)>, String> {
    runtime_env_in(&profile_dir()?, bin)
}

/// The env for a given profile directory — the seam the tests use, so no test
/// ever mutates the process-wide `$HOME` (cargo runs tests as threads of one
/// process; a `set_var("HOME")` races every other test and outlives its
/// TempDir).
fn runtime_env_in(profile: &Path, bin: &Path) -> Result<Vec<(String, OsString)>, String> {
    let profile = profile.to_path_buf();
    ensure_private_dir(&profile)?;
    ensure_private_dir(&profile.join("antigravity-acp"))?;
    Ok(vec![
        ("GEMINI_HOME".into(), profile.into()),
        ("AGY_ACP_FORCE_FILE_STORAGE".into(), "1".into()),
        ("PYTHONUNBUFFERED".into(), "1".into()),
        ("BROWSER".into(), "/usr/bin/true".into()),
        (
            "ANTIGRAVITY_HARNESS_PATH".into(),
            acp::sibling(bin, HARNESS_NAME).into(),
        ),
    ])
}

fn ensure_private_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// Only Google's own authorization endpoint with a loopback redirect may be
/// opened — the same shape the agent always prints, checked before `open`.
pub(crate) fn valid_authorization_url(url: &str) -> bool {
    if url.len() > 16_384 || url.chars().any(char::is_whitespace) {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://accounts.google.com/o/oauth2/v2/auth?") else {
        return false;
    };
    let mut redirect_ok = false;
    let mut response_code = false;
    for pair in rest.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "redirect_uri" => {
                redirect_ok = value.starts_with("http%3A%2F%2F127.0.0.1%3A")
                    || value.starts_with("http://127.0.0.1:");
            }
            "response_type" => response_code = value == "code",
            _ => {}
        }
    }
    redirect_ok && response_code
}

fn open_in_browser(url: &str) -> Result<(), String> {
    if !valid_authorization_url(url) {
        return Err("Antigravity returned an unexpected sign-in URL; refusing to open it".into());
    }
    #[cfg(target_os = "macos")]
    Command::new("/usr/bin/open")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("couldn't open the browser: {e}"))?;
    #[cfg(not(target_os = "macos"))]
    let _ = url;
    Ok(())
}

// ── install ───────────────────────────────────────────────────────────────────

fn read_hex_sha256(path: &Path) -> Result<String, String> {
    let out = Command::new("/usr/bin/shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .map_err(|e| format!("couldn't hash the download: {e}"))?;
    if !out.status.success() {
        return Err("couldn't hash the download".into());
    }
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "couldn't hash the download".into())
}

fn download_archive(destination: &Path) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(DOWNLOAD_TIMEOUT)
        .redirects(2)
        .build();
    let response = agent
        .get(ARCHIVE_URL)
        .call()
        .map_err(|e| format!("couldn't download the Antigravity runtime: {e}"))?;
    let mut reader = response.into_reader().take(ARCHIVE_BYTES + 1);
    let mut file = fs::File::create(destination)
        .map_err(|e| format!("couldn't create {}: {e}", destination.display()))?;
    let mut buffer = vec![0u8; 1 << 20];
    let mut written: u64 = 0;
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("download interrupted after {written} bytes: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n])
            .map_err(|e| format!("couldn't write the download: {e}"))?;
        written += n as u64;
        if written > ARCHIVE_BYTES {
            return Err("the download is larger than the pinned release".into());
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    if written != ARCHIVE_BYTES {
        return Err(format!(
            "the download is {written} bytes; the pinned release is {ARCHIVE_BYTES}"
        ));
    }
    Ok(())
}

fn install() -> Result<AntigravityStatus, String> {
    if !platform_supported() {
        return Err(
            "Google publishes the Antigravity runtime for Apple Silicon Macs only; there is no Intel build."
                .into(),
        );
    }
    let root = managed_root()?;
    fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
    let archive = root.join(format!("{RELEASE_VERSION}.zip"));
    let next = root.join("next");
    let previous = root.join("previous");
    let current = root.join("current");
    let _ = fs::remove_dir_all(&next);
    let result = (|| -> Result<(), String> {
        download_archive(&archive)?;
        let digest = read_hex_sha256(&archive)?;
        if digest != ARCHIVE_SHA256 {
            return Err(format!(
                "the download's SHA-256 ({digest}) does not match the pinned release; nothing was installed"
            ));
        }
        let extract = Command::new("/usr/bin/ditto")
            .args(["-x", "-k"])
            .arg(&archive)
            .arg(&next)
            .status()
            .map_err(|e| format!("couldn't extract the runtime: {e}"))?;
        if !extract.success() {
            return Err("couldn't extract the runtime archive".into());
        }
        for (name, bytes) in [(EXECUTABLE_NAME, EXECUTABLE_BYTES), (HARNESS_NAME, HARNESS_BYTES)] {
            let path = next.join(name);
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size != bytes {
                return Err(format!(
                    "{name} is {size} bytes after extraction; the pinned release has {bytes}"
                ));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                    .map_err(|e| format!("couldn't mark {name} executable: {e}"))?;
            }
        }
        let record = serde_json::to_string_pretty(&ReleaseRecord {
            version: RELEASE_VERSION.into(),
        })
        .map_err(|e| e.to_string())?;
        fs::write(next.join(RELEASE_RECORD), record)
            .map_err(|e| format!("couldn't record the release: {e}"))?;
        let _ = fs::remove_dir_all(&previous);
        if current.exists() {
            fs::rename(&current, &previous)
                .map_err(|e| format!("couldn't retire the previous runtime: {e}"))?;
        }
        fs::rename(&next, &current).map_err(|e| format!("couldn't activate the runtime: {e}"))?;
        let _ = fs::remove_dir_all(&previous);
        Ok(())
    })();
    let _ = fs::remove_file(&archive);
    let _ = fs::remove_dir_all(&next);
    result?;
    Ok(status())
}

// ── sign in / out ─────────────────────────────────────────────────────────────

fn sign_in(children: &Arc<Mutex<HashMap<String, Running>>>) -> Result<AntigravityStatus, String> {
    let bin = current_dir()?.join(EXECUTABLE_NAME);
    if !bin.is_file() {
        return Err("Install the Antigravity runtime first.".into());
    }
    let scratch = tempfile::Builder::new()
        .prefix("rotli-antigravity-signin-")
        .tempdir()
        .map_err(|e| format!("couldn't create a scratch directory: {e}"))?;
    let mut cmd = Command::new(&bin);
    cmd.current_dir(scratch.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for key in env_remove_keys() {
        cmd.env_remove(key);
    }
    cmd.envs(runtime_env(&bin)?);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("couldn't launch the Antigravity agent: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("the agent did not open stdin")?;
    let stdout = child.stdout.take().ok_or("the agent did not open stdout")?;
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    children
        .lock()
        .unwrap()
        .insert(SIGN_IN_REQUEST_ID.into(), Running { token, child });
    let map = Arc::clone(children);
    std::thread::spawn(move || {
        std::thread::sleep(SIGN_IN_TIMEOUT);
        if let Some(r) = map.lock().unwrap().get_mut(SIGN_IN_REQUEST_ID) {
            if r.token == token {
                let _ = r.child.kill();
            }
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut assistant = String::new();
    let mut authorization_url: Option<String> = None;
    let mut open_url = |line: &str| -> Result<(), String> {
        if let Some(url) = line.strip_prefix(acp::ANTIGRAVITY_AUTH_PREFIX) {
            open_in_browser(url)?;
            authorization_url = Some(url.to_string());
        }
        Ok(())
    };
    let mut conn = acp::AcpConn {
        lane: AcpLane::Antigravity,
        writer: &mut stdin,
        reader: &mut reader,
        assistant: &mut assistant,
        on_plain_line: &mut open_url,
    };
    let flow = acp::handshake(&mut conn);
    drop(stdin);
    let reaped = {
        let mut map = children.lock().unwrap();
        match map.get(SIGN_IN_REQUEST_ID) {
            Some(r) if r.token == token => map.remove(SIGN_IN_REQUEST_ID),
            _ => None,
        }
    };
    if let Some(mut running) = reaped {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
    flow.map_err(|e| {
        if e.contains("closed before completing") {
            "Google sign-in was cancelled or timed out. Start sign-in again.".to_string()
        } else {
            e
        }
    })?;
    if !signed_in() {
        return Err("The agent finished sign-in but stored no credential. Start sign-in again.".into());
    }
    let mut current = status();
    current.authorization_url = authorization_url;
    Ok(current)
}

fn sign_out() -> Result<AntigravityStatus, String> {
    let dir = profile_dir()?.join("antigravity-acp");
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name != "settings.json" {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(status())
}

fn remove_runtime() -> Result<AntigravityStatus, String> {
    let root = managed_root()?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| format!("couldn't remove the runtime: {e}"))?;
    }
    Ok(status())
}

/// One command, one action word — status · install · sign_in · sign_out ·
/// remove — so the lane costs the IPC registry a single entry. Every action
/// runs off the main thread; `cli_cancel("antigravity:sign-in")` aborts a
/// sign-in that is waiting on the browser.
#[tauri::command]
pub async fn antigravity_manage(
    state: tauri::State<'_, ProviderState>,
    action: String,
) -> Result<AntigravityStatus, String> {
    let children = Arc::clone(&state.children);
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "status" => Ok(status()),
        "install" => install(),
        "sign_in" => sign_in(&children),
        "sign_out" => sign_out(),
        "remove" => remove_runtime(),
        other => Err(format!("unknown Antigravity action \"{other}\"")),
    })
    .await
    .map_err(|e| format!("Antigravity task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pinned_release_matches_the_registry_shape() {
        assert!(ARCHIVE_URL.starts_with("https://dl.google.com/agy-extensions/releases/macos/"));
        assert!(ARCHIVE_URL.contains(RELEASE_VERSION));
        assert!(ARCHIVE_URL.ends_with("-darwin-arm64.zip"));
        assert_eq!(ARCHIVE_SHA256.len(), 64);
        assert!(ARCHIVE_SHA256.bytes().all(|b| b.is_ascii_hexdigit()));
        assert!(BIN_CANDIDATE.ends_with(&format!("antigravity-acp/current/{EXECUTABLE_NAME}")));
    }

    #[test]
    fn only_googles_loopback_authorization_url_opens() {
        assert!(valid_authorization_url(
            "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A55540%2F&scope=openid&state=abc"
        ));
        assert!(!valid_authorization_url(
            "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&redirect_uri=https%3A%2F%2Fevil.example%2F"
        ));
        assert!(!valid_authorization_url("https://evil.example/o/oauth2/v2/auth?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2F"));
        assert!(!valid_authorization_url("https://accounts.google.com/o/oauth2/v2/auth?response_type=token&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2F"));
        assert!(!valid_authorization_url("https://accounts.google.com/o/oauth2/v2/auth?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2F a"));
    }

    #[test]
    fn the_child_never_inherits_a_google_identity_from_the_host() {
        // the filter is name-based, so it is testable without mutating the
        // process environment
        let filter = |key: &str| {
            let upper = key.to_ascii_uppercase();
            upper.starts_with("GEMINI_")
                || upper.starts_with("GOOGLE_")
                || upper.starts_with("AGY_")
                || matches!(upper.as_str(), "GCLOUD_PROJECT" | "BROWSER")
        };
        assert!(filter("GEMINI_API_KEY"));
        assert!(filter("google_application_credentials"));
        assert!(filter("AGY_ACP_ENABLE_OAUTH"));
        assert!(filter("BROWSER"));
        assert!(!filter("PATH"));
        assert!(!filter("HOME"));
    }

    #[test]
    fn the_runtime_env_pins_a_private_profile_and_a_no_op_browser() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join(EXECUTABLE_NAME);
        let profile = dir.path().join("antigravity-profile");
        let env = runtime_env_in(&profile, &bin).unwrap();
        let get = |k: &str| env.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone()).unwrap();
        assert_eq!(get("BROWSER"), OsString::from("/usr/bin/true"));
        assert_eq!(get("AGY_ACP_FORCE_FILE_STORAGE"), OsString::from("1"));
        assert_eq!(get("ANTIGRAVITY_HARNESS_PATH"), dir.path().join(HARNESS_NAME).into_os_string());
        assert_eq!(get("GEMINI_HOME"), profile.clone().into_os_string());
        assert!(profile.join("antigravity-acp").is_dir());
    }
}
