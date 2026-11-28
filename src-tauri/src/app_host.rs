//! The host entry. Standalone Rotli starts with `run()`, which is
//! `run_with_host` with no host. A host build is a top crate that depends on
//! this library and starts it with its own Tauri context (bundle ID, bundle
//! name, capability files, front end), extra plugins whose commands are its
//! own, its own words (`HostWords`: its refusals, its welcome note, the name
//! in its menus), and the shell's parts it replaces (`without_tray`,
//! `on_opened_urls`, `start_hidden`; `host.rs`).
//! The bundle ID is fixed at build time (`build.rs`, `app_identity.rs`); the
//! app exits at launch if the context names another.
//! (docs/architecture/host-seams.md)

use tauri::plugin::TauriPlugin;
use tauri::{Context, Wry};

use crate::app_identity::HostWords;
use crate::host::ShellOptions;

/// What a host hands Rotli's shell at launch.
pub struct AppHost {
    pub(crate) context: Context<Wry>,
    pub(crate) plugins: Vec<TauriPlugin<Wry>>,
    pub(crate) words: HostWords,
    pub(crate) shell: ShellOptions,
}

impl AppHost {
    /// A host with its own Tauri context, no extra plugins, and Rotli's
    /// neutral wording.
    pub fn new(context: Context<Wry>) -> Self {
        Self { context, plugins: Vec::new(), words: HostWords::default(), shell: ShellOptions::default() }
    }

    /// Add a plugin. Plugins register after Rotli's own, in the order given.
    #[must_use]
    pub fn plugin(mut self, plugin: TauriPlugin<Wry>) -> Self {
        self.plugins.push(plugin);
        self
    }

    /// This build's own words, in place of Rotli's.
    #[must_use]
    pub fn words(mut self, words: HostWords) -> Self {
        self.words = words;
        self
    }

    /// Build no menu-bar item: no tray icon and no tray menu. The host builds
    /// its own and calls `rotli_lib::host::show_main` and `rotli_lib::host::quit`
    /// from it.
    #[must_use]
    pub fn without_tray(mut self) -> Self {
        self.shell = self.shell.without_tray();
        self
    }

    /// Called with the URLs macOS opens the app with that aren't files, before
    /// Rotli opens the files and folders. URLs that arrive before Rotli's
    /// setup is done are held and come in one call from setup; later ones
    /// come one event at a time from the run loop. Set once: a later call
    /// replaces an earlier one.
    #[must_use]
    pub fn on_opened_urls(mut self, hook: impl Fn(&tauri::AppHandle, Vec<tauri::Url>) + Send + Sync + 'static) -> Self {
        self.shell = self.shell.on_opened_urls(Box::new(hook));
        self
    }

    /// Whether this launch starts with no window. `main` is made hidden, and
    /// the predicate is asked once, at the start of Rotli's setup: true keeps
    /// it hidden and keeps the page from showing it as it loads; false shows
    /// it. `rotli_lib::host::show_main` or `rotli_lib::host::open_settings`
    /// shows it later. Inside the predicate,
    /// `rotli_lib::host::launched_as_login_item` says whether this is a login
    /// launch and `rotli_lib::host::pending_opened_urls` which URLs launched
    /// it. Set once: a later call replaces an earlier one.
    #[must_use]
    pub fn start_hidden(mut self, hidden: impl Fn() -> bool + Send + Sync + 'static) -> Self {
        self.shell = self.shell.start_hidden(Box::new(hidden));
        self
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// Only the `rotli` binary expands Rotli's own Tauri context, which
    /// embeds `../dist`. The library never does, so a host crate that links
    /// it (`run_with_host`) compiles without Rotli's front end.
    #[test]
    fn only_the_standalone_binary_expands_rotlis_context() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let main = std::fs::read_to_string(src.join("main.rs")).unwrap();
        assert!(main.contains(concat!("rotli_lib::run(tauri::generate_context", "!())")), "{main}");
        let mut stack = vec![src.clone()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|ext| ext == "rs") && path != src.join("main.rs") {
                    let text = std::fs::read_to_string(&path).unwrap();
                    assert!(!text.contains(concat!("generate_context", "!(")), "{}", path.display());
                }
            }
        }
    }
}
