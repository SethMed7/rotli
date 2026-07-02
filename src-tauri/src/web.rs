//! Web tools for the agentic client — the on-device model's window to the public
//! internet. The webview CSP only allows `ipc:`, so search + fetch run here in Rust
//! (like chat.rs's model bridge). Provider = DuckDuckGo, no API key (Seth, 2026-06-29).
//!
//! SECURITY — the secret-egress backstop. Before any outbound request we run
//! `crate::secret::looks_secure` on the query / URL; a match aborts the call so a
//! secure note's contents can never ride a web request off the machine. The TS
//! orchestrator runs the same check first; this is defense in depth.

use std::io::Read;
use std::time::Duration;

use regex::Regex;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// One web search result the model sees.
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Web search via DuckDuckGo (no key). Returns up to `limit` results (default 5).
/// The egress guard blocks a query that looks like it carries a secret.
#[tauri::command]
pub fn web_search(query: String, limit: Option<usize>) -> Result<Vec<WebResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    if crate::secret::looks_secure(q) {
        return Err(
            "blocked: that query looks like it contains a secret — not sending it to the web.".into(),
        );
    }
    let limit = limit.unwrap_or(5).clamp(1, 10);

    // primary: the lite endpoint — stable flat markup, direct (un-wrapped) URLs.
    let mut results = ddg_lite(q).map(|h| parse_lite(&h)).unwrap_or_default();
    if results.is_empty() {
        // fallback: the html endpoint — URLs arrive wrapped in a /l/?uddg= redirect.
        results = ddg_html(q).map(|h| parse_html(&h)).unwrap_or_default();
    }
    results.truncate(limit);
    Ok(results)
}

/// Fetch a web page and return readable text (HTML stripped, entities decoded).
/// Output is capped (`max_chars`, default 8000) so a page can't blow the small
/// model's context. The egress guard blocks a URL that looks like a secret.
#[tauri::command]
pub fn web_fetch(url: String, max_chars: Option<usize>) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("web_fetch needs an http(s) URL.".into());
    }
    if crate::secret::looks_secure(url) {
        return Err("blocked: that URL looks like it contains a secret — not fetching it.".into());
    }
    let cap = max_chars.unwrap_or(8000).clamp(500, 20_000);
    let resp = ureq::get(url)
        .set("User-Agent", UA)
        .set("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("fetch failed ({e})"))?;
    // read at most ~2 MB so a huge page can't OOM us
    let mut buf = Vec::new();
    resp.into_reader()
        .take(2_000_000)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read failed ({e})"))?;
    let text = html_to_text(&String::from_utf8_lossy(&buf));
    Ok(truncate_chars(&text, cap))
}

// ── DuckDuckGo fetchers (network) ─────────────────────────────────────────────

fn ddg_lite(q: &str) -> Result<String, String> {
    ureq::get("https://lite.duckduckgo.com/lite/")
        .query("q", q)
        .set("User-Agent", UA)
        .set("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| format!("ddg lite ({e})"))?
        .into_string()
        .map_err(|e| e.to_string())
}

fn ddg_html(q: &str) -> Result<String, String> {
    ureq::get("https://html.duckduckgo.com/html/")
        .query("q", q)
        .set("User-Agent", UA)
        .set("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| format!("ddg html ({e})"))?
        .into_string()
        .map_err(|e| e.to_string())
}

// ── parsers (pure — unit-tested without network) ──────────────────────────────

/// lite.duckduckgo.com markup: each result is an `<a class="result-link" href="…">`
/// followed by a `<td class="result-snippet">`. URLs are direct (no redirect).
fn parse_lite(html: &str) -> Vec<WebResult> {
    let link_re = Regex::new(r#"(?is)<a\b([^>]*?)href=["']([^"']+)["']([^>]*?)>(.*?)</a>"#).unwrap();
    let snip_re = Regex::new(r#"(?is)<td[^>]*class=["']result-snippet["'][^>]*>(.*?)</td>"#).unwrap();
    let snippets: Vec<String> = snip_re.captures_iter(html).map(|c| clean_text(&c[1])).collect();
    let mut out = Vec::new();
    for c in link_re.captures_iter(html) {
        let attrs = format!("{} {}", &c[1], &c[3]);
        if !attrs.contains("result-link") {
            continue;
        }
        let url = c[2].trim().to_string();
        if !url.starts_with("http") {
            continue;
        }
        let title = clean_text(&c[4]);
        if title.is_empty() {
            continue;
        }
        let i = out.len();
        out.push(WebResult {
            title,
            url,
            snippet: snippets.get(i).cloned().unwrap_or_default(),
        });
    }
    out
}

/// html.duckduckgo.com markup: `<a class="result__a" href="//duckduckgo.com/l/?uddg=ENC&…">`
/// (the real URL is percent-encoded in `uddg`), snippet in `class="result__snippet"`.
fn parse_html(html: &str) -> Vec<WebResult> {
    let link_re = Regex::new(r#"(?is)<a\b([^>]*?class=["']result__a["'][^>]*?)>(.*?)</a>"#).unwrap();
    let href_re = Regex::new(r#"href=["']([^"']+)["']"#).unwrap();
    let snip_re = Regex::new(r#"(?is)class=["']result__snippet["'][^>]*>(.*?)</a>"#).unwrap();
    let snippets: Vec<String> = snip_re.captures_iter(html).map(|c| clean_text(&c[1])).collect();
    let mut out = Vec::new();
    for c in link_re.captures_iter(html) {
        let href = href_re
            .captures(&c[1])
            .map(|m| m[1].to_string())
            .unwrap_or_default();
        let url = unwrap_ddg_redirect(&href);
        if url.is_empty() {
            continue;
        }
        let title = clean_text(&c[2]);
        if title.is_empty() {
            continue;
        }
        let i = out.len();
        out.push(WebResult {
            title,
            url,
            snippet: snippets.get(i).cloned().unwrap_or_default(),
        });
    }
    out
}

/// Recover the real URL from DDG's `/l/?uddg=…` redirect wrapper (or fix a
/// protocol-relative `//host/…`).
fn unwrap_ddg_redirect(href: &str) -> String {
    if let Some(idx) = href.find("uddg=") {
        let enc = href[idx + 5..].split('&').next().unwrap_or("");
        return percent_decode(enc);
    }
    if href.starts_with("//") {
        return format!("https:{href}");
    }
    href.to_string()
}

// ── HTML → text ───────────────────────────────────────────────────────────────

fn html_to_text(html: &str) -> String {
    static SCRIPT: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static STYLE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static BLOCKS: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let script = SCRIPT.get_or_init(|| Regex::new(r"(?is)<script\b[^>]*>.*?</script>").unwrap());
    let style = STYLE.get_or_init(|| Regex::new(r"(?is)<style\b[^>]*>.*?</style>").unwrap());
    let s = script.replace_all(html, " ");
    let s = style.replace_all(&s, " ");
    // block-level tags become newlines so paragraphs/list items don't run together
    let blocks = BLOCKS.get_or_init(|| {
        Regex::new(r"(?is)<\s*/?\s*(br|p|div|li|tr|h[1-6]|ul|ol|section|article|header|footer|nav|main)\b[^>]*>")
            .unwrap()
    });
    let s = blocks.replace_all(&s, "\n");
    let s = strip_tags(&s);
    let s = decode_entities(&s);
    collapse_ws(&s)
}

fn strip_tags(s: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<[^>]+>").unwrap())
        .replace_all(s, "")
        .to_string()
}

fn clean_text(s: &str) -> String {
    let decoded = decode_entities(&strip_tags(s));
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::new();
    let mut blanks = 0;
    for line in s.lines() {
        let t = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if t.is_empty() {
            blanks += 1;
            if blanks <= 1 {
                out.push('\n');
            }
        } else {
            blanks = 0;
            out.push_str(&t);
            out.push('\n');
        }
    }
    out.trim().to_string()
}

fn decode_entities(s: &str) -> String {
    let mut s = s
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    static NUM: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let num = NUM.get_or_init(|| Regex::new(r"&#(x?[0-9A-Fa-f]+);").unwrap());
    s = num
        .replace_all(&s, |c: &regex::Captures| {
            let raw = &c[1];
            let cp = if let Some(hex) = raw.strip_prefix('x').or_else(|| raw.strip_prefix('X')) {
                u32::from_str_radix(hex, 16).ok()
            } else {
                raw.parse::<u32>().ok()
            };
            cp.and_then(char::from_u32).map(|ch| ch.to_string()).unwrap_or_default()
        })
        .to_string();
    // &amp; last so "&amp;lt;" doesn't become "<"
    s.replace("&amp;", "&")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 3;
                }
                _ => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

// ─── open a rendered link in the browser (#14, audit 2026-07) ────────────────
//
// The editor/chat render markdown links but nothing could OPEN one. This is the
// scheme-allowlisted opener: http/https/mailto ONLY — never file:// (a note
// could point at anything on disk), never a custom scheme (arbitrary app
// launch). The allowlist also guarantees the argument can't start with "-", so
// `open` can't mistake it for a flag.

/// Pure: is this URL safe to hand to the OS opener? Lowercased scheme must be
/// http/https/mailto and the string must carry no whitespace/control chars.
pub fn url_openable(url: &str) -> bool {
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    // a bare scheme opens nothing — require at least one char after it
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:"))
        && lower != "http://"
        && lower != "https://"
        && lower != "mailto:"
}

/// Open a link from a rendered note/chat in the user's browser (or mail app).
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !url_openable(url) {
        return Err("only http(s) and mailto links open from here.".into());
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = url;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lite_parses_a_result() {
        let html = r#"<table>
          <tr><td><a rel="nofollow" href="https://www.rust-lang.org/" class="result-link">Rust Programming Language</a></td></tr>
          <tr><td class="result-snippet">A language empowering everyone to build reliable software.</td></tr>
        </table>"#;
        let r = parse_lite(html);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].url, "https://www.rust-lang.org/");
        assert_eq!(r[0].title, "Rust Programming Language");
        assert!(r[0].snippet.contains("empowering"));
    }

    #[test]
    fn html_unwraps_the_uddg_redirect() {
        let html = r##"<a class="result__a" rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example Page</a>
          <a class="result__snippet" href="#">A short description here.</a>"##;
        let r = parse_html(html);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].url, "https://example.com/page");
        assert_eq!(r[0].title, "Example Page");
        assert!(r[0].snippet.contains("description"));
    }

    #[test]
    fn html_to_text_strips_and_decodes() {
        let t = html_to_text("<p>Hello&nbsp;<b>world</b> &amp; friends</p><script>evil()</script>");
        assert!(t.contains("Hello world & friends"), "got: {t:?}");
        assert!(!t.contains("evil"));
    }

    #[test]
    fn egress_guard_blocks_a_secret_query() {
        let r = web_search("here is my key sk-ant-api03-EXAMPLE0EXAMPLE0EXAM please search".into(), None);
        assert!(r.is_err());
    }

    #[test]
    fn percent_decode_basics() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("https%3A%2F%2Fx.com"), "https://x.com");
    }

    #[test]
    fn url_openable_allows_only_web_and_mail_schemes() {
        assert!(url_openable("https://example.com/page?q=1"));
        assert!(url_openable("http://localhost:3000/x"));
        assert!(url_openable("HTTPS://EXAMPLE.COM")); // scheme case-insensitive
        assert!(url_openable("mailto:seth@example.com"));
        // never these: disk paths, app launches, flags, injection shapes
        assert!(!url_openable("file:///etc/passwd"));
        assert!(!url_openable("javascript:alert(1)"));
        assert!(!url_openable("x-apple.systempreferences:"));
        assert!(!url_openable("-a Calculator"));
        assert!(!url_openable("https://a.com/ b")); // whitespace
        assert!(!url_openable("https://a.com/\u{0}b")); // control char
        assert!(!url_openable("https://")); // bare scheme
        assert!(!url_openable("mailto:"));
        assert!(!url_openable(""));
    }
}
