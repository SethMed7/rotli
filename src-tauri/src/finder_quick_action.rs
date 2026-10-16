//! Settings → General → "Open in Rotli" in Finder (docs/design/open-in-rotli.md,
//! stage 3): an opt-in Quick Action. Installing writes ONE Automator workflow,
//! `~/Library/Services/Open in Rotli.workflow`, whose only step runs
//! `open -b <this app's bundle id> "$@"` — the selected files and folders reach
//! Rotli exactly the way Open With and a Dock drop do (`deep_link::parse`'s
//! `file://` branch). It writes outside the app, so it is never installed
//! silently, and Remove deletes only a workflow Rotli made (the marker key
//! below) — never one of the person's own that happens to share the name.

use std::fs;
use std::path::{Path, PathBuf};

const WORKFLOW: &str = "Open in Rotli.workflow";
/// The Info.plist key that marks a workflow as Rotli's own.
const MARKER: &str = "RotliQuickAction";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Installed {
    Absent,
    Ours,
    /// A workflow with the same name that Rotli didn't make: left alone.
    Theirs,
}

fn workflow_dir(services: &Path) -> PathBuf {
    services.join(WORKFLOW)
}

/// A bundle id is only letters, digits, dots, and hyphens — the shell step
/// never carries anything else.
fn checked_bundle_id(bundle_id: &str) -> Result<&str, String> {
    let ok = !bundle_id.is_empty()
        && bundle_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    ok.then_some(bundle_id).ok_or_else(|| format!("unexpected app identifier {bundle_id:?}"))
}

pub(crate) fn status(services: &Path) -> Installed {
    let info = workflow_dir(services).join("Contents/Info.plist");
    match fs::read_to_string(&info) {
        Ok(text) if text.contains(&format!("<key>{MARKER}</key>")) => Installed::Ours,
        Ok(_) => Installed::Theirs,
        Err(_) if workflow_dir(services).exists() => Installed::Theirs,
        Err(_) => Installed::Absent,
    }
}

pub(crate) fn install(services: &Path, bundle_id: &str) -> Result<(), String> {
    let bundle_id = checked_bundle_id(bundle_id)?;
    if status(services) == Installed::Theirs {
        return Err(format!(
            "You already have a Quick Action named “{}”. Rename or remove it first; Rotli won’t replace it.",
            WORKFLOW.trim_end_matches(".workflow")
        ));
    }
    // build beside, then swap in: a half-written workflow never shows in Finder
    let staging = services.join(format!(".{WORKFLOW}.rotli-new"));
    let _ = fs::remove_dir_all(&staging);
    let contents = staging.join("Contents");
    fs::create_dir_all(&contents).map_err(|e| format!("create {}: {e}", contents.display()))?;
    fs::write(contents.join("Info.plist"), info_plist(bundle_id)).map_err(|e| e.to_string())?;
    fs::write(contents.join("document.wflow"), document_wflow(bundle_id)).map_err(|e| e.to_string())?;
    let target = workflow_dir(services);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| format!("replace {}: {e}", target.display()))?;
    }
    fs::rename(&staging, &target).map_err(|e| format!("install {}: {e}", target.display()))
}

pub(crate) fn remove(services: &Path) -> Result<(), String> {
    match status(services) {
        Installed::Absent => Ok(()),
        Installed::Theirs => Err("That Quick Action isn’t Rotli’s, so Rotli leaves it alone.".into()),
        Installed::Ours => fs::remove_dir_all(workflow_dir(services)).map_err(|e| e.to_string()),
    }
}

fn status_word(installed: Installed) -> &'static str {
    match installed {
        Installed::Absent => "absent",
        Installed::Ours => "installed",
        Installed::Theirs => "theirs",
    }
}

/// `~/Library/Services`, where macOS looks for Quick Actions (Mac only).
fn user_services() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("Finder Quick Actions are a Mac feature.".into());
    }
    let home = std::env::var("HOME").map_err(|_| "no home folder".to_string())?;
    Ok(Path::new(&home).join("Library/Services"))
}

/// `absent` · `installed` · `theirs` (a same-named workflow Rotli didn't make).
#[tauri::command]
pub(crate) fn finder_quick_action_status() -> Result<String, String> {
    Ok(status_word(status(&user_services()?)).into())
}

/// Add (or remove) the Quick Action — only ever on the person's click in
/// Settings. Returns the new status word.
#[tauri::command]
pub(crate) async fn finder_quick_action_set(app: tauri::AppHandle, installed: bool) -> Result<String, String> {
    let bundle_id = app.config().identifier.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let services = user_services()?;
        if installed {
            fs::create_dir_all(&services).map_err(|e| format!("create {}: {e}", services.display()))?;
            install(&services, &bundle_id)?;
        } else {
            remove(&services)?;
        }
        // ask macOS to re-read its services now rather than at next login
        // (best effort: Finder also notices on its own, a moment later)
        let _ = std::process::Command::new("/System/Library/CoreServices/pbs").arg("-update").status();
        Ok(status_word(status(&services)).into())
    })
    .await
    .map_err(|e| format!("quick action worker failed ({e})"))?
}

fn info_plist(bundle_id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>{MARKER}</key>
	<string>{bundle_id}</string>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>Open in Rotli</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
"#
    )
}

fn document_wflow(bundle_id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>528</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>open -b {bundle_id} "$@"</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>4F2D3B8E-6C1A-4E57-9A0B-2E7D5C1F8A31</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>8B6E1C4A-3D2F-4A90-B7E5-6F1C2D9A4E07</string>
				<key>UUID</key>
				<string>C3A9E5D1-7B42-4F8C-9E06-1A5D3B7C2F94</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:253.000000</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key>
		<dict/>
		<key>applicationPaths</key>
		<array/>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn install_writes_one_workflow_that_opens_this_app_and_remove_takes_it_back() {
        let services = TempDir::new().unwrap();
        assert_eq!(status(services.path()), Installed::Absent);
        install(services.path(), "com.rotli.app").unwrap();
        assert_eq!(status(services.path()), Installed::Ours);
        let flow = fs::read_to_string(workflow_dir(services.path()).join("Contents/document.wflow")).unwrap();
        assert!(flow.contains(r#"open -b com.rotli.app "$@""#), "{flow}");
        let names: Vec<_> = fs::read_dir(services.path()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from(WORKFLOW)], "nothing else written, no staging left");
        install(services.path(), "com.rotli.dev").unwrap();
        let flow = fs::read_to_string(workflow_dir(services.path()).join("Contents/document.wflow")).unwrap();
        assert!(flow.contains("open -b com.rotli.dev"), "reinstalling updates the app it opens");
        remove(services.path()).unwrap();
        assert_eq!(status(services.path()), Installed::Absent);
        remove(services.path()).unwrap();
    }

    #[test]
    fn a_workflow_of_the_persons_own_with_the_same_name_is_never_replaced_or_removed() {
        let services = TempDir::new().unwrap();
        let theirs = workflow_dir(services.path()).join("Contents");
        fs::create_dir_all(&theirs).unwrap();
        fs::write(theirs.join("Info.plist"), "<plist><dict/></plist>").unwrap();
        assert_eq!(status(services.path()), Installed::Theirs);
        assert!(install(services.path(), "com.rotli.app").unwrap_err().contains("already have"));
        assert!(remove(services.path()).unwrap_err().contains("isn’t Rotli’s"));
        assert_eq!(fs::read_to_string(theirs.join("Info.plist")).unwrap(), "<plist><dict/></plist>");
    }

    #[test]
    fn a_bundle_id_with_anything_but_letters_digits_dots_and_hyphens_is_refused() {
        let services = TempDir::new().unwrap();
        for bad in ["", "com.rotli.app\"; rm -rf ~", "com rotli", "$(id)"] {
            assert!(install(services.path(), bad).is_err(), "{bad:?}");
        }
        assert_eq!(status(services.path()), Installed::Absent);
    }

    /// The native proof (macOS, run on purpose): the generated files are valid
    /// property lists, and Automator runs the workflow, handing the selected
    /// paths to its one step. The step's `open` is swapped for a `printf` into
    /// a temp file, so no app opens. `cargo test -- --ignored automator`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn automator_runs_the_workflow_with_the_selected_paths() {
        use std::process::Command;
        let services = TempDir::new().unwrap();
        install(services.path(), "com.rotli.app").unwrap();
        let contents = workflow_dir(services.path()).join("Contents");
        for file in ["Info.plist", "document.wflow"] {
            let lint = Command::new("/usr/bin/plutil").arg("-lint").arg(contents.join(file)).output().unwrap();
            assert!(lint.status.success(), "{file}: {}", String::from_utf8_lossy(&lint.stdout));
        }
        let out = services.path().join("args.txt");
        let flow = contents.join("document.wflow");
        let text = fs::read_to_string(&flow).unwrap().replace(
            r#"open -b com.rotli.app "$@""#,
            &format!(r#"printf '%s\n' "$@" &gt; '{}'"#, out.display()),
        );
        fs::write(&flow, text).unwrap();
        let picked = services.path().join("Trip notes.md");
        fs::write(&picked, "# Trip\n").unwrap();
        let run = Command::new("/usr/bin/automator")
            .arg("-i")
            .arg(&picked)
            .arg(workflow_dir(services.path()))
            .output()
            .unwrap();
        assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
        assert_eq!(fs::read_to_string(&out).unwrap().trim(), picked.display().to_string());
    }
}
