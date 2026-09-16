//! `rotli-helper` — the standalone loopback bridge that lets Rotli Web drive the
//! user's own connected AI CLIs. See `rotli_lib::helper` for the threat model.
//!
//! Deliberately NOT `#![windows_subsystem = "windows"]`: the pairing code is
//! printed to stdout and a hidden console would hide the one thing the user
//! must copy.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(error) = rotli_lib::helper::run(&args) {
        eprintln!("rotli-helper: {error}");
        std::process::exit(1);
    }
}
