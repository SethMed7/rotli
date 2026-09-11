fn main() {
    println!("cargo:rerun-if-env-changed=ROTLI_BUILD_CHANNEL");
    let channel = std::env::var("ROTLI_BUILD_CHANNEL").unwrap_or_else(|_| {
        if std::env::var("PROFILE").as_deref() == Ok("debug") { "dev" } else { "stable" }.into()
    });
    assert!(matches!(channel.as_str(), "stable" | "dev"), "Invalid ROTLI_BUILD_CHANNEL");
    println!("cargo:rustc-env=ROTLI_BUILD_CHANNEL={channel}");
    tauri_build::build()
}
