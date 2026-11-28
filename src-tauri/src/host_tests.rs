//! The quiet start, `open_settings`, what is held for the main page and the
//! queue of opened URLs (host.rs; docs/architecture/host-seams.md, "A quiet
//! start", "Held for the page" and "Opened URLs").

use super::tests::{body, in_setup_order, IDENTITY_CHECK, OPENED_RELEASE};
use super::*;
use crate::single_instance::tests::source as src;
use std::path::Path;

fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

/// Rotli's own window list, as standalone's context carries it.
fn rotli_windows() -> Vec<WindowConfig> {
    let conf: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
            .unwrap(),
    )
    .unwrap();
    serde_json::from_value(conf["app"]["windows"].clone()).unwrap()
}

/// A predicate that counts how often it is asked.
fn counted(answer: bool) -> (StartHidden, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    let asked = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = asked.clone();
    let predicate: StartHidden = Box::new(move || {
        count.fetch_add(1, Ordering::Relaxed);
        answer
    });
    (predicate, asked)
}

#[test]
fn standalone_launch_leaves_every_window_exactly_as_configured() {
    let mut windows = rotli_windows();
    let main = windows.iter().find(|w| w.label == "main").expect("a main window");
    assert!(main.visible && main.maximized, "standalone's main window shows at creation");
    let quiet = QuietStart::new();
    quiet.arm(None, &mut windows);
    assert_eq!(windows, rotli_windows());
    assert!(!quiet.skips_launch_show(), "the page's load-time show shows, at the same moment as before");
    assert_eq!(quiet.decide(), None, "and setup decides nothing");
    assert!(!quiet.skips_launch_show());
}

/// A host with a predicate always has `main` made hidden, so the decision
/// can wait for the launch's Apple event without a window on screen.
#[test]
fn a_predicate_makes_only_main_hidden_and_is_not_asked_at_launch() {
    let (predicate, asked) = counted(true);
    let mut windows = rotli_windows();
    let quiet = QuietStart::new();
    quiet.arm(Some(predicate), &mut windows);
    assert_eq!(asked.load(Ordering::Relaxed), 0, "not asked before the app finished launching");
    let mut expected = rotli_windows();
    expected.iter_mut().find(|w| w.label == "main").unwrap().visible = false;
    assert_eq!(windows, expected, "only main's `visible` changes; size, maximize and the rest stay");
    assert!(quiet.skips_launch_show(), "the page can't show the window before the decision");
    // a host's own visible window beside main stays visible
    let mut with_own = rotli_windows();
    let mut own = with_own[0].clone();
    own.label = "synthetic-panel".into();
    with_own.push(own.clone());
    hide_main_at_creation(&mut with_own);
    assert_eq!(with_own.last(), Some(&own));
    // a context with no main window: nothing to hide, nothing breaks
    let mut others: Vec<WindowConfig> = rotli_windows().into_iter().filter(|w| w.label != "main").collect();
    let before = others.clone();
    hide_main_at_creation(&mut others);
    assert_eq!(others, before);
}

#[test]
fn setup_asks_once_and_shows_the_window_unless_the_answer_is_yes() {
    let (predicate, asked) = counted(false);
    let quiet = QuietStart::new();
    quiet.arm(Some(predicate), &mut rotli_windows());
    assert_eq!(quiet.decide(), Some(true), "a no shows the window in setup");
    assert!(!quiet.skips_launch_show(), "and the page's load-time show shows too, as standalone's does");
    assert_eq!(quiet.decide(), None, "asked once");
    assert_eq!(asked.load(Ordering::Relaxed), 1);

    let (predicate, asked) = counted(true);
    let quiet = QuietStart::new();
    quiet.arm(Some(predicate), &mut rotli_windows());
    assert_eq!(quiet.decide(), Some(false), "a yes leaves it hidden");
    assert!(quiet.skips_launch_show(), "and keeps the page's load-time show from showing it");
    assert_eq!(quiet.decide(), None);
    assert_eq!(asked.load(Ordering::Relaxed), 1);
}

/// A relaunch, or any launch that isn't a login item, shows its window: the
/// documented predicate reads the login flag, which no such launch carries.
#[test]
fn a_launch_that_is_not_a_login_item_shows_its_window() {
    assert!(!launched_as_login_item(), "no launch Apple event is current here, as in a relaunch");
    let quiet = QuietStart::new();
    quiet.arm(Some(Box::new(launched_as_login_item)), &mut rotli_windows());
    assert_eq!(quiet.decide(), Some(true));
    assert!(!quiet.skips_launch_show());
}

#[test]
fn only_the_page_load_show_is_skipped_and_only_after_a_quiet_start() {
    assert!(
        shows_main(true, false),
        "standalone's page shows the window as it loads"
    );
    assert!(shows_main(false, false));
    assert!(
        !shows_main(true, true),
        "a quiet start: the page's own show as it loads does nothing"
    );
    assert!(
        shows_main(false, true),
        "every other show still shows, after a quiet start too"
    );
}

#[test]
fn only_the_main_page_takes_what_was_held_for_it() {
    let (notices, settings) = (Held::new(), Held::new());
    assert_eq!(
        notices.arrive(vec!["refused".to_string()]),
        Vec::<String>::new()
    );
    assert_eq!(
        settings.arrive(vec!["appearance".to_string(), "synthetic".to_string()]),
        Vec::<String>::new()
    );
    for other in ["chat", "quick", "capture", "folder-1"] {
        assert_eq!(
            page_ready_for(other, &notices, &settings),
            HeldForPage::default(),
            "{other}"
        );
    }
    assert_eq!(
        page_ready_for("main", &notices, &settings),
        HeldForPage {
            notices: vec!["refused".into()],
            settings: vec!["appearance".into(), "synthetic".into()]
        },
    );
    assert_eq!(
        notices.arrive(vec!["later".to_string()]),
        vec!["later".to_string()],
        "sent as it comes"
    );
    assert_eq!(
        page_ready_for("main", &notices, &settings),
        HeldForPage::default(),
        "nothing twice"
    );
}

/// Every notice for the main page and every Settings request goes through
/// the hold: nothing else in Rotli sends either to main.
#[test]
fn notices_and_settings_requests_reach_main_only_through_the_hold() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut stack = vec![dir.clone()];
    while let Some(next) = stack.pop() {
        for entry in std::fs::read_dir(next).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") && path != dir.join("host.rs")
            {
                let text = std::fs::read_to_string(&path).unwrap();
                for event in ["\"main\", \"rotli:open-notice\"", "\"rotli:open-settings\""] {
                    assert!(
                        !text.contains(event),
                        "{} sends {event} past the hold",
                        path.display()
                    );
                }
            }
        }
    }
    let host = src("host.rs");
    let production = &host[..host.find("#[cfg(test)]").unwrap()];
    assert!(body(production, "notice").contains("NOTICES.arrive("));
    assert!(body(production, "open_settings").contains("SETTINGS.arrive("));
    assert!(body(production, "host_page_ready").contains("page_ready_for(webview.label()"));
    let lib = src("lib.rs");
    assert!(lib.contains("host::host_page_ready,") && lib.contains("host::show_main_window,"));
    // the window list is changed before the builder makes any window
    let launch = body(&lib, "launch");
    let apply = launch
        .find("host::apply_at_launch(")
        .expect("launch applies the shell");
    assert!(apply < launch.find(".build(context)").unwrap(), "{launch}");
}

/// The quiet start's wires: launch arms the one `QUIET` the command reads,
/// setup decides inside `applicationDidFinishLaunching` (after the identity
/// check, before anything opens), and the page makes its load-time call with
/// `atLaunch`.
#[test]
fn the_quiet_start_is_wired_from_launch_to_the_page() {
    let host = src("host.rs");
    let production = &host[..host.find("#[cfg(test)]").unwrap()];
    assert!(body(production, "apply_at_launch").contains("QUIET.arm(shell.start_hidden, windows)"));
    let decide = body(production, "decide_at_launch");
    assert!(decide.contains("QUIET.decide() == Some(true)") && decide.contains("show_main(app)"), "{decide}");
    let command = body(production, "show_main_window");
    assert!(command.contains("QUIET.skips_launch_show()") && command.contains("at_launch == Some(true)"), "{command}");

    let lib = src("lib.rs");
    assert_eq!(lib.matches("host::decide_at_launch(").count(), 1);
    in_setup_order(
        &lib,
        &[IDENTITY_CHECK, "host::decide_at_launch(app.handle())", "app_identity::ensure_scratch_vault(app.handle())", OPENED_RELEASE],
    );

    let web = |path: &str| std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(path)).unwrap();
    let persist = web("src/state/persist.ts");
    let effects = &persist[persist.find("function applyShellSideEffects(").expect("the page's launch effects")..];
    let effects = &effects[..effects.find("\n}\n").unwrap()];
    assert!(effects.contains("showMainWindow(true)"), "the page's load-time show says so: {effects}");
    assert_eq!(effects.matches("showMainWindow").count(), 1, "and it is the only show there: {effects}");
    let tauri = web("src/lib/tauri.ts");
    let show = &tauri[tauri.find("export async function showMainWindow(").unwrap()..];
    let show = &show[..show.find("\n}\n").unwrap()];
    assert!(show.contains(r#"invoke("show_main_window", atLaunch ? { atLaunch } : {})"#), "{show}");
}

/// The login flag is read off the launch event: an open-application event
/// with `keyAELaunchedAsLogInItem` is a login launch; the same event without
/// it (`open`, Finder, the Dock, a relaunch) and any other event are not.
#[cfg(target_os = "macos")]
#[test]
fn only_an_open_event_marked_as_a_login_item_is_a_login_launch() {
    use super::login_item::*;
    use objc2::msg_send;
    use objc2::ClassType;
    use objc2::rc::Retained;
    use objc2_foundation::NSAppleEventDescriptor;
    let event = |id: u32| -> Retained<NSAppleEventDescriptor> {
        let core: u32 = u32::from_be_bytes(*b"aevt");
        let none: Option<&NSAppleEventDescriptor> = None;
        unsafe {
            msg_send![NSAppleEventDescriptor::class(), appleEventWithEventClass: core, eventID: id, targetDescriptor: none, returnID: -1i16, transactionID: 0i32]
        }
    };
    let mark = |event: &NSAppleEventDescriptor, code: u32| {
        let value: Retained<NSAppleEventDescriptor> =
            unsafe { msg_send![NSAppleEventDescriptor::class(), descriptorWithEnumCode: code] };
        let _: () = unsafe { msg_send![event, setParamDescriptor: &*value, forKeyword: KEY_AE_PROP_DATA] };
    };
    let login = event(K_AE_OPEN_APPLICATION);
    mark(&login, KEY_AE_LAUNCHED_AS_LOG_IN_ITEM);
    assert!(is_login_launch(&login));
    assert!(!is_login_launch(&event(K_AE_OPEN_APPLICATION)), "a plain open: Finder, the Dock, `open`, a relaunch");
    let other = event(K_AE_OPEN_APPLICATION);
    mark(&other, u32::from_be_bytes(*b"svce"));
    assert!(!is_login_launch(&other), "another launch reason");
    let reopen = event(u32::from_be_bytes(*b"rapp"));
    mark(&reopen, KEY_AE_LAUNCHED_AS_LOG_IN_ITEM);
    assert!(!is_login_launch(&reopen), "not an open-application event");
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

/// A `start_hidden` predicate reads the URLs already waiting, files and
/// folders left out, and the hook still gets every one of them when setup
/// releases the queue.
#[test]
fn pending_urls_are_seen_before_setup_and_stay_held_for_the_hook() {
    let queue = OpenedQueue::new();
    assert_eq!(pending_in(&queue), Vec::<Url>::new(), "a plain launch has none");
    queue.arrive(vec![url("file:///tmp/launch.md")]);
    assert_eq!(pending_in(&queue), Vec::<Url>::new(), "a file is Rotli's to open, never the host's");
    queue.arrive(vec![url("synthetic-host://run/one")]);
    queue.arrive(vec![url("file:///tmp/launch-folder/"), url("synthetic-host://run/two")]);
    let seen = vec![url("synthetic-host://run/one"), url("synthetic-host://run/two")];
    assert_eq!(pending_in(&queue), seen, "every event's URLs, in the order they came");
    assert_eq!(pending_in(&queue), seen, "asking takes nothing");
    let released = queue.release();
    assert_eq!(
        released,
        vec![
            url("file:///tmp/launch.md"),
            url("synthetic-host://run/one"),
            url("file:///tmp/launch-folder/"),
            url("synthetic-host://run/two"),
        ],
        "setup still gets everything, files included"
    );
    assert_eq!(route_opened(&released).host, seen, "the hook gets what the predicate saw");
}

/// After the release nothing is pending: a later URL goes straight on. And
/// standalone never fills the queue (the run loop's gate, fenced in
/// `host::tests`), so a call there is empty too.
#[test]
fn no_urls_are_pending_after_the_release_or_in_standalone() {
    let queue = OpenedQueue::new();
    queue.arrive(vec![url("synthetic-host://run/one")]);
    queue.release();
    assert_eq!(pending_in(&queue), Vec::<Url>::new(), "released");
    let late = url("synthetic-host://run/late");
    assert_eq!(queue.arrive(vec![late.clone()]), vec![late], "a late URL goes straight to the hook");
    assert_eq!(pending_in(&queue), Vec::<Url>::new(), "and is never pending");

    // the process's own queue, which only a host build's `Opened` events fill
    assert_eq!(pending_opened_urls(), Vec::<Url>::new());
    let host = src("host.rs");
    let production = &host[..host.find("#[cfg(test)]").unwrap()];
    assert!(body(production, "pending_opened_urls").contains("pending_in(&OPENED)"));
}
