//! What a host build reaches of Rotli's shell from its own code: the menu-bar
//! item, which a host can leave to its own tray, the calls that tray makes, and
//! the URLs macOS opens the app with (docs/architecture/host-seams.md, "The
//! menu-bar item" and "Opened URLs"). Standalone Rotli builds its tray here
//! and sends no URL through this module: its deep-link plugin takes them.

use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::{AppHandle, Url};

/// A host's handler for the URLs macOS opens its app with.
pub type OpenedUrls = Box<dyn Fn(&AppHandle, Vec<Url>) + Send + Sync>;

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

/// The shell's parts a host can change at launch (`AppHost::without_tray`,
/// `AppHost::on_opened_urls`). The default is standalone Rotli's.
pub(crate) struct ShellOptions {
    pub(crate) tray: bool,
    pub(crate) on_opened_urls: Option<OpenedUrls>,
}

impl Default for ShellOptions {
    fn default() -> Self {
        Self { tray: true, on_opened_urls: None }
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

/// URLs from `Opened` events, held until setup is done. AppKit can send the
/// files a launch was asked to open before the app finishes launching, so
/// before Rotli's setup has checked the identity or opened a vault, and before
/// a host's hook can show anything. Standalone's deep-link plugin holds its
/// own (`get_current`).
pub(crate) struct OpenedQueue(Mutex<Option<Vec<Url>>>);

impl OpenedQueue {
    pub(crate) const fn new() -> Self {
        Self(Mutex::new(Some(Vec::new())))
    }

    /// Before `release`, holds `urls` and returns none; after, returns them
    /// to open now.
    pub(crate) fn arrive(&self, urls: Vec<Url>) -> Vec<Url> {
        match self.0.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
            Some(held) => {
                held.extend(urls);
                Vec::new()
            }
            None => urls,
        }
    }

    /// Everything held, in the order it came; from now on nothing is held.
    pub(crate) fn release(&self) -> Vec<Url> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).take().unwrap_or_default()
    }
}

static OPENED: OpenedQueue = OpenedQueue::new();
static HOOK: OnceLock<OpenedUrls> = OnceLock::new();

/// The host's hook, set once at launch, before the run loop starts.
pub(crate) fn set_opened_urls(hook: Option<OpenedUrls>) {
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
    fn body<'a>(text: &'a str, name: &str) -> &'a str {
        let start = text.find(&format!("fn {name}(")).unwrap_or_else(|| panic!("no fn {name}"));
        let rest = &text[start..];
        let end = rest.find("\n\u{7d}\n").expect("fn ends");
        &rest[..end]
    }

    #[test]
    fn opened_urls_wait_until_setup_is_done_then_pass_straight_through() {
        let queue = OpenedQueue::new();
        assert_eq!(queue.arrive(vec![url("synthetic-host://one")]), Vec::<Url>::new(), "held before setup");
        assert_eq!(queue.arrive(vec![url("file:///tmp/a.md"), url("synthetic-host://two")]), Vec::<Url>::new());
        assert_eq!(
            queue.release(),
            vec![url("synthetic-host://one"), url("file:///tmp/a.md"), url("synthetic-host://two")],
            "setup gets every held URL, in the order they came"
        );
        assert_eq!(queue.arrive(vec![url("synthetic-host://three")]), vec![url("synthetic-host://three")]);
        assert_eq!(queue.release(), Vec::<Url>::new(), "nothing is held twice");
    }

    /// The hook gets the host's URLs in one call, before Rotli opens any file
    /// from the same event, and no call when there are none.
    #[test]
    fn the_hook_runs_once_with_only_the_hosts_urls_before_rotli_opens_a_file() {
        use std::cell::RefCell;
        let log = RefCell::new(Vec::<String>::new());
        let hook = |urls: Vec<Url>| log.borrow_mut().push(format!("hook {}", urls.iter().map(Url::as_str).collect::<Vec<_>>().join(" ")));
        let open = |url: &Url| log.borrow_mut().push(format!("open {url}"));
        let event = [url("file:///tmp/a.md"), url("synthetic-host://one"), url("file:///tmp/b/"), url("rotli://open?id=x")];
        dispatch(&event, Some(&hook), open);
        assert_eq!(
            log.take(),
            [
                "hook synthetic-host://one rotli://open?id=x",
                "open file:///tmp/a.md",
                "open file:///tmp/b/",
            ]
        );
        dispatch(&[url("file:///tmp/a.md")], Some(&hook), open);
        assert_eq!(log.take(), ["open file:///tmp/a.md"], "no host URL, no hook call");
        dispatch(&[url("synthetic-host://one")], None, open);
        assert_eq!(log.take(), Vec::<String>::new(), "no hook, nothing for Rotli");
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
        assert!(on_run.contains("!crate::app_identity::owns_shared_state()"), "{on_run}");
        let arrive = on_run.find("OPENED.arrive(").expect("the run loop holds early URLs");
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
        assert_eq!(lib.matches("host::ready(").count(), 1);
        let setup = &lib[lib.find(".setup(move |app| \u{7b}").expect("setup")..];
        let identity = setup.find("app_identity::matches_runtime(").unwrap();
        let vaults = setup.find("app.manage(corpus::CorpusState(").unwrap();
        let drain = setup.find("host::ready(").unwrap();
        assert!(identity < vaults && vaults < drain, "the drain follows the identity check and the vaults");
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
