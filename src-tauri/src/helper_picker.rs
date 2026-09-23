//! The OS's own folder picker, opened by Rotli Helper when a paired page asks
//! for `vault_choose`. The person at the keyboard picks the folder; the page
//! never supplies a path. `Ok(None)` is a closed picker. Nothing here touches
//! the network — each picker is a local program the OS ships (or, on Linux,
//! the desktop's own dialog tool).

use std::path::PathBuf;
use std::process::Command;

const PROMPT: &str = "Choose the folder for your Rotli vault";

pub(crate) fn native_folder_picker() -> Result<Option<PathBuf>, String> {
    let chosen = run_picker()?;
    // a trailing separator is the picker's habit, not part of the name; a
    // drive root trims to nothing and is refused like a cancel
    let trimmed = chosen.trim().trim_end_matches(['/', '\\']);
    Ok((!trimmed.is_empty()).then(|| PathBuf::from(trimmed)))
}

#[cfg(target_os = "macos")]
fn run_picker() -> Result<String, String> {
    // `activate` brings the dialog in front of the browser the request came from
    let script = format!("POSIX path of (choose folder with prompt \"{PROMPT}\")");
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", "activate", "-e", &script])
        .output()
        .map_err(|e| format!("couldn't open the folder picker: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    // -128 is AppleScript's "User canceled."
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("-128") {
        return Ok(String::new());
    }
    Err(format!("the folder picker failed: {}", stderr.trim()))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_picker() -> Result<String, String> {
    let attempts: [(&str, Vec<String>); 2] = [
        ("zenity", vec!["--file-selection".into(), "--directory".into(), format!("--title={PROMPT}")]),
        ("kdialog", vec!["--getexistingdirectory".into(), std::env::var("HOME").unwrap_or_default(), "--title".into(), PROMPT.into()]),
    ];
    for (program, args) in attempts {
        match Command::new(program).args(&args).output() {
            // both tools exit 1 on cancel, with nothing on stdout
            Ok(output) if output.status.success() => return Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
            Ok(_) => return Ok(String::new()),
            Err(_) => continue, // not installed: try the next desktop's tool
        }
    }
    Err("No folder picker is installed (zenity or kdialog). Run `rotli-helper --vault <folder>` instead.".into())
}

#[cfg(windows)]
fn run_picker() -> Result<String, String> {
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '{PROMPT}'; if ($d.ShowDialog() -eq 'OK') {{ $d.SelectedPath }}"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-STA", "-Command", &script])
        .output()
        .map_err(|e| format!("couldn't open the folder picker: {e}"))?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
