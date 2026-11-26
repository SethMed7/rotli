fn main() {
    println!("cargo:rerun-if-env-changed=ROTLI_BUILD_CHANNEL");
    let channel = std::env::var("ROTLI_BUILD_CHANNEL").unwrap_or_else(|_| {
        if std::env::var("PROFILE").as_deref() == Ok("debug") { "dev" } else { "stable" }.into()
    });
    assert!(matches!(channel.as_str(), "stable" | "dev"), "Invalid ROTLI_BUILD_CHANNEL");
    println!("cargo:rustc-env=ROTLI_BUILD_CHANNEL={channel}");
    println!("cargo:rustc-env=ROTLI_APP_IDENTIFIER={}", app_identifier());
    tauri_build::build()
}

/// The bundle identifier this build ships as. A host build names it outright
/// in `ROTLI_APP_IDENTIFIER`; otherwise it is read the way Tauri reads it: the
/// `--config` overlay the Tauri CLI hands cargo in `TAURI_CONFIG`, then
/// `tauri.conf.json`. `src/app_identity.rs` is the one place that reads it, and
/// the app exits at launch if its Tauri context names another one.
fn app_identifier() -> String {
    println!("cargo:rerun-if-env-changed=ROTLI_APP_IDENTIFIER");
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let identifier = |json: &str| -> Option<String> {
        let value: serde_json::Value = serde_json::from_str(json).ok()?;
        value.get("identifier")?.as_str().map(str::to_string)
    };
    let named = std::env::var("ROTLI_APP_IDENTIFIER").ok().filter(|id| !id.is_empty());
    let base = std::fs::read_to_string("tauri.conf.json").expect("read tauri.conf.json");
    let overlay = std::env::var("TAURI_CONFIG").ok().and_then(|json| identifier(&json));
    let identifier = named
        .or(overlay)
        .or_else(|| identifier(&base))
        .expect("tauri.conf.json names an identifier");
    assert!(
        !identifier.is_empty() && identifier.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'),
        "Invalid bundle identifier {identifier:?}"
    );
    identifier
}
