//! The host entry. Standalone Rotli starts with `run()`, which is
//! `run_with_host` with no host. A host build is a top crate that depends on
//! this library and starts it with its own Tauri context (bundle ID, bundle
//! name, capability files, front end), extra plugins whose commands are its
//! own, and the sentences a person reads where it declines Rotli's shared
//! state. The bundle ID is fixed at build time (`build.rs`,
//! `app_identity.rs`); the app exits at launch if the context names another.
//! (docs/architecture/host-seams.md)

use tauri::plugin::TauriPlugin;
use tauri::{Context, Wry};

use crate::app_identity::HostWords;

/// What a host hands Rotli's shell at launch.
pub struct AppHost {
    pub(crate) context: Context<Wry>,
    pub(crate) plugins: Vec<TauriPlugin<Wry>>,
    pub(crate) words: HostWords,
}

impl AppHost {
    /// A host with its own Tauri context, no extra plugins, and Rotli's
    /// neutral wording.
    pub fn new(context: Context<Wry>) -> Self {
        Self { context, plugins: Vec::new(), words: HostWords::default() }
    }

    /// Add a plugin. Plugins register after Rotli's own, in the order given.
    #[must_use]
    pub fn plugin(mut self, plugin: TauriPlugin<Wry>) -> Self {
        self.plugins.push(plugin);
        self
    }

    /// The sentences a person reads where this build declines shared state.
    #[must_use]
    pub fn words(mut self, words: HostWords) -> Self {
        self.words = words;
        self
    }
}
