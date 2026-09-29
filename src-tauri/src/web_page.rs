//! What `web_fetch` can say about a page beyond its text (split from web.rs,
//! 2026-09-29): the same-site page a `#/route` link names (a hash-routed app
//! never sends its route to the server), and the notice for a page that is
//! only a script-drawn shell, so the model says it couldn't read it rather
//! than reviewing a blank page. Pure: no network here.

use tauri::Url;

/// `https://site/#/piece/x` (or `#!/piece/x`) → `https://site/piece/x` on the
/// same origin; `None` when the fragment is not a route. The route replaces
/// the whole path, which fits an app served at `/` (rotli studio); an app
/// hosted under a subpath simply keeps its original, longer-text answer.
pub(crate) fn hash_route_page(url: &Url) -> Option<Url> {
    let fragment = url.fragment()?;
    let route = fragment
        .strip_prefix("!/")
        .or_else(|| fragment.strip_prefix('/'))?;
    let route = route.split(['?', '#']).next()?.trim_end_matches('/');
    if route.is_empty() {
        return None;
    }
    let mut page = url.clone();
    page.set_fragment(None);
    page.set_query(None);
    page.set_path(&format!("/{route}"));
    Some(page)
}

/// A page whose content is drawn by JavaScript reaches us as its bare shell
/// ("Loading…"). Say so, so the model reports it could not read the page
/// instead of reviewing the shell as if it were the content.
pub(crate) fn script_shell_notice(url: &str, html: &str, text: &str) -> Option<String> {
    const THIN_CHARS: usize = 400;
    let chars = text.chars().count();
    if chars >= THIN_CHARS || !html.to_ascii_lowercase().contains("<script") {
        return None;
    }
    let route = if url.contains("#/") || url.contains("#!") {
        " The part of the link after \"#\" is read by the page's script and never reaches the server."
    } else {
        ""
    };
    Some(format!(
        "NOTE: this page builds its content with JavaScript, which web_fetch does not run — only its {chars}-character shell was read.{route} Tell the user you couldn't read what the page shows; don't describe or review content you didn't see."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web::html_to_text;

    #[test]
    fn a_hash_route_names_the_same_page_as_a_path() {
        let page = |raw: &str| hash_route_page(&Url::parse(raw).unwrap()).map(|u| u.to_string());
        assert_eq!(
            page("https://studio.rotli.co/#/piece/s01e02PlainWords").as_deref(),
            Some("https://studio.rotli.co/piece/s01e02PlainWords")
        );
        assert_eq!(page("https://x.test/app#!/a/b/?tab=2").as_deref(), Some("https://x.test/a/b"));
        // an in-page anchor or an empty route is not a route
        assert_eq!(page("https://x.test/docs#install"), None);
        assert_eq!(page("https://x.test/#/"), None);
        assert_eq!(page("https://x.test/page"), None);
    }


    #[test]
    fn a_script_drawn_page_is_flagged_as_a_shell() {
        let shell = r#"<html><head><title>rotli studio</title><script type="module" src="/app.js"></script></head><body><p>Loading the studio…</p></body></html>"#;
        let text = html_to_text(shell);
        let notice = script_shell_notice("https://studio.example/#/piece/a", shell, &text).unwrap();
        assert!(notice.contains("JavaScript") && notice.contains("after \"#\""), "got: {notice}");
        // no hash route → no fragment sentence
        let plain = script_shell_notice("https://studio.example/", shell, &text).unwrap();
        assert!(!plain.contains("after \"#\""));
        // a real article, or a thin page with no script, reads as-is
        let article = format!("<script>x()</script><p>{}</p>", "word ".repeat(200));
        assert!(script_shell_notice("https://a.example/", &article, &html_to_text(&article)).is_none());
        let thin = "<p>Short static page.</p>";
        assert!(script_shell_notice("https://a.example/", thin, &html_to_text(thin)).is_none());
    }
}
