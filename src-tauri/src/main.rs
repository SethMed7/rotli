// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(status) = rotli_lib::run_headless_if_requested(&args) {
        std::process::exit(status);
    }
    rotli_lib::run()
}
