//! The quiet start, `open_settings` and what is held for the main page
//! (host.rs; docs/architecture/host-seams.md, "A quiet start" and "Held for
//! the page").

use super::tests::body;
use super::*;
use crate::single_instance::tests::source as src;
use std::path::Path;

/// Rotli's own window list, as standalone's context carries it.
fn rotli_windows() -> Vec<WindowConfig> {
    let conf: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
            .unwrap(),
    )
    .unwrap();
    serde_json::from_value(conf["app"]["windows"].clone()).unwrap()
}

#[test]
fn standalone_launch_leaves_every_window_exactly_as_configured() {
    let mut windows = rotli_windows();
    let main = windows
        .iter()
        .find(|w| w.label == "main")
        .expect("a main window");
    assert!(
        main.visible && main.maximized,
        "standalone's main window shows at creation"
    );
    assert!(
        apply_at_launch(ShellOptions::default(), &mut windows),
        "the tray stays on"
    );
    assert_eq!(windows, rotli_windows());
    // a host that answers no changes nothing either
    let mut windows = rotli_windows();
    assert!(apply_at_launch(
        ShellOptions::default().start_hidden(Box::new(|| false)),
        &mut windows
    ));
    assert_eq!(windows, rotli_windows());
}

#[test]
fn a_quiet_start_makes_only_the_main_window_hidden_and_asks_once() {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    let asked = Arc::new(AtomicUsize::new(0));
    let count = asked.clone();
    let shell = ShellOptions::default()
        .without_tray()
        .start_hidden(Box::new(move || {
            count.fetch_add(1, Ordering::Relaxed);
            true
        }));
    let mut windows = rotli_windows();
    assert!(
        !apply_at_launch(shell, &mut windows),
        "the host's tray choice still holds"
    );
    assert_eq!(asked.load(Ordering::Relaxed), 1);
    let mut expected = rotli_windows();
    expected
        .iter_mut()
        .find(|w| w.label == "main")
        .unwrap()
        .visible = false;
    assert_eq!(
        windows, expected,
        "only main's `visible` changes; size, maximize and the rest stay"
    );
    // a host's own visible window beside main stays visible
    let mut with_own = rotli_windows();
    let mut own = with_own[0].clone();
    own.label = "synthetic-panel".into();
    with_own.push(own.clone());
    hide_main_at_creation(&mut with_own);
    assert_eq!(
        with_own.last(),
        Some(&own),
        "{:?}",
        with_own.last().map(|w| w.visible)
    );
    // a context with no main window: nothing to hide, nothing breaks
    let mut others: Vec<WindowConfig> = rotli_windows()
        .into_iter()
        .filter(|w| w.label != "main")
        .collect();
    let before = others.clone();
    hide_main_at_creation(&mut others);
    assert_eq!(others, before);
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
