//! What a host build reaches of Rotli's shell from its own code: the menu-bar
//! item, which a host can leave to its own tray, the calls that tray makes, the
//! URLs macOS opens the app with, a quiet start, and what the main page is
//! told before it listens (docs/architecture/host-seams.md, "The menu-bar
//! item", "Opened URLs", "Opening Settings", "A quiet start" and "Held for the
//! page"). Standalone Rotli builds its tray here and sends no URL through this
//! module: its deep-link plugin takes them.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Emitter, Url};

/// A host's handler for the URLs macOS opens its app with.
pub type OpenedUrls = Box<dyn Fn(&AppHandle, Vec<Url>) + Send + Sync>;

/// A host's answer, asked once as the app finishes launching, to whether this
/// launch keeps its window hidden. It can read `launched_as_login_item` and
/// `pending_opened_urls`.
pub type StartHidden = Box<dyn Fn() -> bool + Send + Sync>;

/// Show and focus the main window, as Rotli's tray item "Open …" does.
pub fn show_main(app: &AppHandle) {
    crate::SummonIntent::ShowMain.perform(app);
}

/// Quit as Rotli's Quit does: every window saves first, then the app exits.
/// It returns at once; a window that can't save keeps the app open and says
/// why in the main window.
pub fn quit(app: &AppHandle) {
    crate::graceful_quit(app);
}

/// Show Settings on the pane `pane_id`, Rotli's or the host's, in the main
/// window. The page judges the id as a pane's link is judged: an id no pane
/// has, or a pane that doesn't show right now, does nothing (and warns under
/// the dev server); otherwise the window comes forward on that pane. A request
/// made before the page listens is held until it does.
pub fn open_settings(app: &AppHandle, pane_id: &str) {
    for pane in SETTINGS.arrive(vec![pane_id.to_string()]) {
        let _ = app.emit_to("main", "rotli:open-settings", pane);
    }
}

/// The shell's parts a host can change at launch (`AppHost::without_tray`,
/// `AppHost::on_opened_urls`, `AppHost::start_hidden`). The default is
/// standalone Rotli's.
pub(crate) struct ShellOptions {
    pub(crate) tray: bool,
    pub(crate) on_opened_urls: Option<OpenedUrls>,
    pub(crate) start_hidden: Option<StartHidden>,
}

impl Default for ShellOptions {
    fn default() -> Self {
        Self { tray: true, on_opened_urls: None, start_hidden: None }
    }
}

impl ShellOptions {
    pub(crate) fn without_tray(mut self) -> Self {
        self.tray = false;
        self
    }

    pub(crate) fn on_opened_urls(mut self, hook: OpenedUrls) -> Self {
        self.on_opened_urls = Some(hook);
        self
    }

    pub(crate) fn start_hidden(mut self, hidden: StartHidden) -> Self {
        self.start_hidden = Some(hidden);
        self
    }
}

/// Whether this launch starts with no window. A host that passes
/// `start_hidden` has `main` made hidden, then is asked once setup runs,
/// inside `applicationDidFinishLaunching`, where the launch's Apple event is
/// still current (`decide_at_launch`); a no shows the window there. Until
/// then, and after a yes, the page's load-time show is skipped. Nothing here
/// hides a window, so a show before the decision stands.
pub(crate) struct QuietStart {
    state: AtomicU8,
    predicate: Mutex<Option<StartHidden>>,
}

const NO_PREDICATE: u8 = 0;
const UNDECIDED: u8 = 1;
const SHOWN: u8 = 2;
const HIDDEN: u8 = 3;

impl QuietStart {
    pub(crate) const fn new() -> Self {
        Self { state: AtomicU8::new(NO_PREDICATE), predicate: Mutex::new(None) }
    }

    /// At launch, before any window: with a predicate, `main` is made hidden
    /// and the predicate kept for `decide`. Without one, nothing changes.
    fn arm(&self, predicate: Option<StartHidden>, windows: &mut [WindowConfig]) {
        let Some(predicate) = predicate else { return };
        hide_main_at_creation(windows);
        *self.predicate.lock().unwrap_or_else(PoisonError::into_inner) = Some(predicate);
        self.state.store(UNDECIDED, Ordering::Release);
    }

    /// Asks the predicate, once. `Some(true)`: show the window now.
    fn decide(&self) -> Option<bool> {
        let predicate = self.predicate.lock().unwrap_or_else(PoisonError::into_inner).take()?;
        let show = !predicate();
        self.state.store(if show { SHOWN } else { HIDDEN }, Ordering::Release);
        Some(show)
    }

    /// Whether the page's load-time show is skipped: before the decision, and
    /// after a yes.
    fn skips_launch_show(&self) -> bool {
        matches!(self.state.load(Ordering::Acquire), UNDECIDED | HIDDEN)
    }
}

static QUIET: QuietStart = QuietStart::new();

/// The launch's shell options, applied before the builder makes any window:
/// the opened-URL hook is set and the quiet start armed. Gives whether to
/// build the tray. Standalone passes the defaults, which leave `windows`
/// untouched.
pub(crate) fn apply_at_launch(shell: ShellOptions, windows: &mut [WindowConfig]) -> bool {
    set_opened_urls(shell.on_opened_urls);
    QUIET.arm(shell.start_hidden, windows);
    shell.tray
}

/// Setup, inside `applicationDidFinishLaunching`: the host's `start_hidden`
/// is asked now, while the launch Apple event is current, and a no shows the
/// window. Standalone has no predicate and nothing happens.
pub(crate) fn decide_at_launch(app: &AppHandle) {
    if QUIET.decide() == Some(true) {
        show_main(app);
    }
}

/// Whether macOS launched this process as a login item: the launch's Apple
/// event (`oapp`) carries `keyAELaunchedAsLogInItem`. Only meaningful inside
/// `start_hidden`, which runs while that event is current; anywhere else,
/// and in a relaunch or a launch from Finder, the Dock or `open`, it is false.
/// It reads AppKit's current event, so it answers only on the main thread;
/// off the main thread it returns false.
pub fn launched_as_login_item() -> bool {
    #[cfg(target_os = "macos")]
    {
        let manager = objc2_foundation::NSAppleEventManager::sharedAppleEventManager();
        manager.currentAppleEvent().is_some_and(|event| login_item::is_login_launch(&event))
    }
    #[cfg(not(target_os = "macos"))]
    false
}

#[cfg(target_os = "macos")]
pub(crate) mod login_item {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2_foundation::NSAppleEventDescriptor;

    // the four-character codes from AppleEvents.h
    pub(crate) const K_AE_OPEN_APPLICATION: u32 = u32::from_be_bytes(*b"oapp");
    pub(crate) const KEY_AE_PROP_DATA: u32 = u32::from_be_bytes(*b"prdt");
    pub(crate) const KEY_AE_LAUNCHED_AS_LOG_IN_ITEM: u32 = u32::from_be_bytes(*b"lgit");

    /// An open-application event whose property data says "login item".
    /// `eventID` and `paramDescriptorForKeyword:` sit behind another crate's
    /// feature in objc2-foundation, so they are sent directly.
    pub(crate) fn is_login_launch(event: &NSAppleEventDescriptor) -> bool {
        let id: u32 = unsafe { msg_send![event, eventID] };
        let data: Option<Retained<NSAppleEventDescriptor>> =
            unsafe { msg_send![event, paramDescriptorForKeyword: KEY_AE_PROP_DATA] };
        id == K_AE_OPEN_APPLICATION && data.is_some_and(|data| data.enumCodeValue() == KEY_AE_LAUNCHED_AS_LOG_IN_ITEM)
    }
}

/// The main window's config entry made hidden, so the window is never ordered
/// on screen until something shows it (`show_main`, `open_settings`).
fn hide_main_at_creation(windows: &mut [WindowConfig]) {
    if let Some(main) = windows.iter_mut().find(|window| window.label == "main") {
        main.visible = false;
    }
}

/// Whether the webview's `show_main_window` shows the window: always, except
/// the call the page makes as it loads while the quiet start skips it.
fn shows_main(at_launch: bool, skips_launch_show: bool) -> bool {
    !(at_launch && skips_launch_show)
}

/// The webview's way to show the main window. The page's own call as it
/// loads passes `at_launch`.
#[tauri::command]
pub(crate) fn show_main_window(app: AppHandle, at_launch: Option<bool>) {
    if shows_main(at_launch == Some(true), QUIET.skips_launch_show()) {
        show_main(&app);
    }
}

/// The tray's first item.
pub(crate) fn open_label(product: &str) -> String {
    format!("Open {product}")
}

/// The tray's last item, and the app menu's Quit.
pub(crate) fn quit_label(product: &str) -> String {
    format!("Quit {product}")
}

/// Rotli's menu-bar item: its mark as a template icon (macOS tints it; 44px is
/// 22px logical @2x), "Open …" and "Quit …", and a left click that toggles the
/// main window. The only place Rotli touches a tray API; the shell calls it
/// only when the tray is on.
pub(crate) fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let product = crate::app_identity::product_name();
    let open_item = MenuItemBuilder::with_id("open", open_label(product)).build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", quit_label(product)).build(app)?;
    let menu = MenuBuilder::new(app).items(&[&open_item, &quit_item]).build()?;
    TrayIconBuilder::with_id("rotli")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            // let the webview flush dirty sheets/settings first (#4)
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::SummonIntent::ToggleMainFromTray.perform(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Where one `Opened` event's URLs go in a host build: files and folders to
/// Rotli's own open path, everything else to the host.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct OpenedRoute {
    pub(crate) host: Vec<Url>,
    pub(crate) files: Vec<Url>,
}

pub(crate) fn route_opened(urls: &[Url]) -> OpenedRoute {
    let (files, host) = urls.iter().cloned().partition(|url| url.scheme() == "file");
    OpenedRoute { host, files }
}

/// Items held until whatever they need is ready, then passed straight on.
pub(crate) struct Held<T>(Mutex<Option<Vec<T>>>);

impl<T> Held<T> {
    pub(crate) const fn new() -> Self {
        Self(Mutex::new(Some(Vec::new())))
    }

    /// Before `release`, holds `items` and returns none; after, returns them
    /// to act on now.
    pub(crate) fn arrive(&self, items: Vec<T>) -> Vec<T> {
        match self.0.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
            Some(held) => {
                held.extend(items);
                Vec::new()
            }
            None => items,
        }
    }

    /// A copy of what is held, which stays held; empty after `release`.
    pub(crate) fn peek(&self) -> Vec<T>
    where
        T: Clone,
    {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).clone().unwrap_or_default()
    }

    /// Everything held, in the order it came; from now on nothing is held.
    pub(crate) fn release(&self) -> Vec<T> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).take().unwrap_or_default()
    }
}

/// URLs from `Opened` events, held until setup is done. AppKit can send the
/// files a launch was asked to open before the app finishes launching, so
/// before Rotli's setup has checked the identity or opened a vault, and before
/// a host's hook can show anything. Standalone's deep-link plugin holds its
/// own (`get_current`).
pub(crate) type OpenedQueue = Held<Url>;

static OPENED: OpenedQueue = OpenedQueue::new();

/// The URLs macOS has opened the app with that still wait for setup, `file:`
/// ones left out: what the `on_opened_urls` hook is handed when setup releases
/// them. Nothing is taken. It is for the `start_hidden` predicate; standalone
/// Rotli and a call after the release get none. A URL that arrives after the
/// predicate was asked is not here and reaches the hook alone
/// (docs/architecture/host-seams.md, "A quiet start").
pub fn pending_opened_urls() -> Vec<Url> {
    pending_in(&OPENED)
}

fn pending_in(queue: &OpenedQueue) -> Vec<Url> {
    route_opened(&queue.peek()).host
}

/// What the main page is told before it listens, held until it says it does:
/// the notices it shows (a refused file or folder) and `open_settings`
/// requests. Setup runs before the page loads, so a cold launch's notice
/// would otherwise go to no listener.
static NOTICES: Held<String> = Held::new();
static SETTINGS: Held<String> = Held::new();

/// A notice for the main page: a sentence about something handed over from
/// outside that didn't open. Held until the page listens.
pub(crate) fn notice(app: &AppHandle, message: String) {
    for message in NOTICES.arrive(vec![message]) {
        let _ = app.emit_to("main", "rotli:open-notice", message);
    }
}

/// What the main page missed before it listened.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
pub(crate) struct HeldForPage {
    pub(crate) notices: Vec<String>,
    pub(crate) settings: Vec<String>,
}

/// The page in `label` listens now. Only the main page takes what is held:
/// every window loads the same bundle, and another must not take main's.
fn page_ready_for(label: &str, notices: &Held<String>, settings: &Held<String>) -> HeldForPage {
    if label != "main" {
        return HeldForPage::default();
    }
    HeldForPage { notices: notices.release(), settings: settings.release() }
}

/// The page calls this once its listeners are registered: it gets what was
/// held, and from now on each notice and request is sent as it comes.
#[tauri::command]
pub(crate) fn host_page_ready(webview: tauri::Webview) -> HeldForPage {
    page_ready_for(webview.label(), &NOTICES, &SETTINGS)
}

static HOOK: OnceLock<OpenedUrls> = OnceLock::new();

/// The host's hook, set once at launch, before the run loop starts.
fn set_opened_urls(hook: Option<OpenedUrls>) {
    if let Some(hook) = hook {
        let _ = HOOK.set(hook);
    }
}

/// Every run-loop event passes here first. Only a host build acts, and only on
/// `Opened`: standalone Rotli's deep-link plugin takes those URLs itself.
pub(crate) fn on_run_event(app: &AppHandle, event: &tauri::RunEvent) {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    if let tauri::RunEvent::Opened { urls } = event {
        if !crate::app_identity::owns_shared_state() {
            let now = OPENED.arrive(urls.clone());
            opened(app, &now);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = (app, event);
}

/// Setup is done in a host build (the identity checked, the vaults open, the
/// main window made): open what arrived before it.
pub(crate) fn ready(app: &AppHandle) {
    let held = OPENED.release();
    opened(app, &held);
}

fn opened(app: &AppHandle, urls: &[Url]) {
    let hook = HOOK.get().map(|hook| move |urls: Vec<Url>| hook(app, urls));
    dispatch(urls, hook.as_ref().map(|hook| hook as &dyn Fn(Vec<Url>)), |url| {
        crate::open_requests::handle_deep_link(app, url);
    });
}

/// The host's URLs go to its hook first, in one call. Then Rotli opens the
/// files and folders, as Finder's Open With and a Dock drop open them in
/// standalone Rotli, behind the vault refusal (open_requests.rs).
pub(crate) fn dispatch(urls: &[Url], hook: Option<&dyn Fn(Vec<Url>)>, mut open_file: impl FnMut(&Url)) {
    let route = route_opened(urls);
    if let Some(hook) = hook.filter(|_| !route.host.is_empty()) {
        hook(route.host);
    }
    for url in &route.files {
        open_file(url);
    }
}

#[cfg(test)]
#[path = "host_tests.rs"]
mod page_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_identity::{product_name_in, HostWords, STANDALONE_PRODUCT_NAME};
    use crate::single_instance::tests::source as src;
    use std::path::Path;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn standalone_labels_stay_exactly_as_they_were() {
        let standalone = HostWords::default();
        let product = product_name_in(&standalone);
        assert_eq!(product, STANDALONE_PRODUCT_NAME);
        assert_eq!(open_label(product), "Open rotli");
        assert_eq!(quit_label(product), "Quit rotli");
    }

    #[test]
    fn a_host_name_replaces_rotli_in_every_label() {
        let words = HostWords { product_name: Some("Synthetic Notes".into()), ..Default::default() };
        let product = product_name_in(&words);
        assert_eq!(open_label(product), "Open Synthetic Notes");
        assert_eq!(quit_label(product), "Quit Synthetic Notes");
        // a blank name is no name: never "Quit "
        for blank in ["", "   "] {
            let words = HostWords { product_name: Some(blank.into()), ..Default::default() };
            assert_eq!(quit_label(product_name_in(&words)), "Quit rotli", "{blank:?}");
        }
    }

    #[test]
    fn the_default_shell_is_standalone_rotlis_and_each_option_changes_only_itself() {
        let standalone = ShellOptions::default();
        assert!(standalone.tray);
        assert!(standalone.on_opened_urls.is_none());

        let no_tray = ShellOptions::default().without_tray();
        assert!(!no_tray.tray);
        assert!(no_tray.on_opened_urls.is_none());

        let hooked = ShellOptions::default().on_opened_urls(Box::new(|_, _| {}));
        assert!(hooked.tray);
        assert!(hooked.on_opened_urls.is_some());

        let both = ShellOptions::default().on_opened_urls(Box::new(|_, _| {})).without_tray();
        assert!(!both.tray);
        assert!(both.on_opened_urls.is_some());
    }

    #[test]
    fn a_host_gets_every_url_but_files_and_folders_which_rotli_opens() {
        let urls = [
            url("synthetic-host://open?item=1"),
            url("file:///tmp/Synthetic%20folder/note.md"),
            url("https://example.com/page"),
            url("file:///tmp/Synthetic%20folder/"),
            url("rotli://open?id=Inbox/a.md"),
        ];
        assert_eq!(
            route_opened(&urls),
            OpenedRoute {
                host: vec![
                    url("synthetic-host://open?item=1"),
                    url("https://example.com/page"),
                    url("rotli://open?id=Inbox/a.md"),
                ],
                files: vec![url("file:///tmp/Synthetic%20folder/note.md"), url("file:///tmp/Synthetic%20folder/")],
            }
        );
        assert_eq!(route_opened(&[]), OpenedRoute::default());
    }

    /// The body of `fn name` in `text`, up to the next top-level item.
    pub(super) fn body<'a>(text: &'a str, name: &str) -> &'a str {
        let start = text.find(&format!("fn {name}(")).unwrap_or_else(|| panic!("no fn {name}"));
        let rest = &text[start..];
        let end = rest.find("\n\u{7d}\n").expect("fn ends");
        &rest[..end]
    }

    /// Nothing an `Opened` event carries is acted on before setup: the run
    /// loop goes through the queue, and setup drains it only after the
    /// identity check and once the vaults are open.
    #[test]
    fn opened_urls_reach_the_hook_and_rotli_only_after_setup() {
        let host = src("host.rs");
        let production = &host[..host.find("#[cfg(test)]").unwrap()];
        assert_eq!(production.matches("RunEvent::Opened").count(), 1);
        let on_run = body(production, "on_run_event");
        let gate = on_run.find("!crate::app_identity::owns_shared_state()").expect("never in standalone");
        let arrive = on_run.find("OPENED.arrive(").expect("the run loop holds early URLs");
        assert!(gate < arrive, "{on_run}");
        assert_eq!(production.matches("OPENED.arrive(").count(), 1, "one way into the queue");
        assert!(arrive < on_run.find("opened(app, ").expect("and opens the rest"), "{on_run}");
        let ready = body(production, "ready");
        assert!(ready.find("OPENED.release()").unwrap() < ready.find("opened(app, ").unwrap(), "{ready}");
        assert_eq!(production.matches("opened(app, ").count(), 2, "on_run_event and ready only");
        // the host's registered hook, then Rotli's own file opening
        let wired = body(production, "opened");
        assert!(wired.contains("HOOK.get()") && wired.contains("open_requests::handle_deep_link("), "{wired}");

        let lib = src("lib.rs");
        let run = &lib[lib.find(".run(|app, event| \u{7b}").expect("the run loop")..];
        assert_eq!(run.lines().nth(1).unwrap().trim(), "host::on_run_event(app, &event);");
        assert_eq!(lib.matches("RunEvent::Opened").count(), 0, "Opened is read only in host.rs");
        assert_eq!(lib.matches(OPENED_RELEASE).count(), 1);
        in_setup_order(&lib, &[IDENTITY_CHECK, "app.manage(corpus::CorpusState(", OPENED_RELEASE]);
    }

    /// Two steps of Rotli's setup that other steps are ordered against.
    pub(super) const IDENTITY_CHECK: &str = "app_identity::matches_runtime(";
    pub(super) const OPENED_RELEASE: &str = "host::ready(";

    /// `calls` appear in Rotli's setup closure in this order.
    pub(super) fn in_setup_order(lib: &str, calls: &[&str]) {
        let setup = &lib[lib.find(".setup(move |app| \u{7b}").expect("setup")..];
        let at: Vec<usize> = calls.iter().map(|call| setup.find(call).unwrap_or_else(|| panic!("no {call} in setup"))).collect();
        assert!(at.windows(2).all(|pair| pair[0] < pair[1]), "setup runs {calls:?} in this order");
    }

    /// With the tray off, Rotli touches no tray API: every one lives in
    /// `build_tray`, and the shell calls it only when the tray is on.
    #[test]
    fn a_host_without_the_tray_never_reaches_a_tray_api() {
        const TRAY_APIS: [&str; 5] = ["TrayIconBuilder", "TrayIcon", "tray_by_id", "remove_tray", "tauri::tray"];
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut stack = vec![dir.clone()];
        while let Some(next) = stack.pop() {
            for entry in std::fs::read_dir(next).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") && path != dir.join("host.rs") {
                    let text = std::fs::read_to_string(&path).unwrap();
                    for api in TRAY_APIS {
                        assert!(!text.contains(api), "{} uses {api}", path.display());
                    }
                }
            }
        }
        let host = src("host.rs");
        let production = &host[..host.find("#[cfg(test)]").unwrap()];
        let tray = body(production, "build_tray");
        for api in TRAY_APIS {
            assert_eq!(production.matches(api).count(), tray.matches(api).count(), "{api} outside build_tray");
        }

        let lib = src("lib.rs");
        assert_eq!(lib.matches("host::build_tray(").count(), 1);
        let call = lib.find("host::build_tray(").unwrap();
        let guard = lib[..call].trim_end().lines().last().unwrap().trim();
        assert_eq!(guard, "if tray \u{7b}", "the tray is built only when it's on");

        // the front end has no tray of its own to look up
        let web = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src");
        let mut stack = vec![web];
        while let Some(next) = stack.pop() {
            for entry in std::fs::read_dir(next).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "ts" || e == "tsx") {
                    let text = std::fs::read_to_string(&path).unwrap();
                    assert!(!text.contains("@tauri-apps/api/tray"), "{}", path.display());
                }
            }
        }
    }
}
