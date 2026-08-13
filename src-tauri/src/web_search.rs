//! Public-web search adapters. Provider choice is explicit and never falls
//! through to another destination: DuckDuckGo is the keyless default; Brave
//! reads its BYOK credential from Keychain at request time.

use std::error::Error as _;
use std::io::{self, Read};
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use tauri::Url;

const DDG_LITE_URL: &str = "https://lite.duckduckgo.com/lite/";
const DDG_HTML_URL: &str = "https://html.duckduckgo.com/html/";
const BRAVE_WEB_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SEARCH_TIMEOUT: Duration = Duration::from_secs(10);
const SEARCH_BODY_MAX_BYTES: u64 = 1_000_000;
const WEB_QUERY_MAX_CHARS: usize = 512;
const RESULT_TITLE_MAX_CHARS: usize = 300;
const RESULT_URL_MAX_CHARS: usize = 2048;
const RESULT_SNIPPET_MAX_CHARS: usize = 1200;

#[derive(serde::Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchProvider {
    Duckduckgo,
    Brave,
}

impl SearchProvider {
    fn label(self) -> &'static str {
        match self {
            Self::Duckduckgo => "DuckDuckGo",
            Self::Brave => "Brave Search API",
        }
    }
}

/// One normalized result. Repeating the provider on every item keeps a result
/// self-describing after the AI loop numbers and trims it.
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebResult {
    pub provider: SearchProvider,
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FailureKind {
    MissingKey,
    Unauthorized,
    RateLimited,
    Timeout,
    Network,
    Upstream(u16),
    Challenge,
    Incompatible,
    Malformed,
    ResponseTooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SearchFailure {
    provider: SearchProvider,
    kind: FailureKind,
}

impl SearchFailure {
    fn new(provider: SearchProvider, kind: FailureKind) -> Self {
        Self { provider, kind }
    }

    fn user_message(self) -> String {
        let provider = self.provider.label();
        match self.kind {
            FailureKind::MissingKey => format!(
                "{provider} key missing. Add your key in Settings → Connections → Web research."
            ),
            FailureKind::Unauthorized => format!(
                "{provider} rejected the saved key. Update or remove it in Settings → Connections → Web research."
            ),
            FailureKind::RateLimited => format!(
                "{provider} refused the request because the account is rate-limited or out of quota. Check the Brave dashboard or choose another provider in Settings."
            ),
            FailureKind::Timeout => {
                format!("{provider} timed out. Check the connection and try again.")
            }
            FailureKind::Network => {
                format!("{provider} could not be reached. Check the connection and try again.")
            }
            FailureKind::Upstream(status) => format!(
                "{provider} returned an upstream HTTP error ({status}). Try again later or choose another provider in Settings."
            ),
            FailureKind::Challenge => format!(
                "{provider} returned a bot/challenge page instead of search results. Its free endpoint availability can vary; try again later or choose another provider in Settings."
            ),
            FailureKind::Incompatible => format!(
                "{provider} returned a response Rotli could not read. The provider may have changed its page format; try again later or choose another provider in Settings."
            ),
            FailureKind::Malformed => format!(
                "{provider} returned a malformed search response. Try again later or choose another provider in Settings."
            ),
            FailureKind::ResponseTooLarge => format!(
                "{provider} returned an unexpectedly large response, so Rotli stopped reading it. Try a narrower query."
            ),
        }
    }
}

#[derive(Debug, Clone)]
struct SearchRequest {
    url: &'static str,
    query: Vec<(&'static str, String)>,
    headers: Vec<(&'static str, String)>,
}

#[derive(Debug, Clone)]
struct SearchResponse {
    status: u16,
    body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportFailure {
    Timeout,
    Network,
    ResponseTooLarge,
}

trait SearchTransport {
    fn get(&mut self, request: SearchRequest) -> Result<SearchResponse, TransportFailure>;
}

struct UreqSearchTransport;

fn read_search_body(reader: impl Read) -> Result<String, TransportFailure> {
    let mut bytes = Vec::new();
    reader
        .take(SEARCH_BODY_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| match error.kind() {
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => TransportFailure::Timeout,
            _ => TransportFailure::Network,
        })?;
    if bytes.len() as u64 > SEARCH_BODY_MAX_BYTES {
        return Err(TransportFailure::ResponseTooLarge);
    }
    String::from_utf8(bytes).map_err(|_| TransportFailure::Network)
}

fn transport_failure(error: ureq::Transport) -> TransportFailure {
    let io_timeout = error
        .source()
        .and_then(|source| source.downcast_ref::<io::Error>())
        .is_some_and(|source| {
            matches!(
                source.kind(),
                io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
            )
        });
    // Some TLS/proxy stacks wrap the underlying io::Error. Retain a bounded
    // classification fallback, but never surface this provider error (or its
    // URL/query) to the user.
    let message = error.to_string().to_ascii_lowercase();
    if io_timeout || message.contains("timed out") || message.contains("timeout") {
        TransportFailure::Timeout
    } else {
        TransportFailure::Network
    }
}

impl SearchTransport for UreqSearchTransport {
    fn get(&mut self, request: SearchRequest) -> Result<SearchResponse, TransportFailure> {
        // Search destinations are literal provider endpoints. Redirects are
        // disabled so neither DNS nor an upstream response can change egress.
        let agent = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(SEARCH_TIMEOUT)
            .build();
        let mut call = agent.request("GET", request.url).set("User-Agent", UA);
        for (name, value) in &request.headers {
            call = call.set(name, value);
        }
        for (name, value) in &request.query {
            call = call.query(name, value);
        }
        match call.timeout(SEARCH_TIMEOUT).call() {
            Ok(response) => Ok(SearchResponse {
                status: response.status(),
                body: read_search_body(response.into_reader())?,
            }),
            Err(ureq::Error::Status(status, response)) => Ok(SearchResponse {
                status,
                body: read_search_body(response.into_reader())?,
            }),
            Err(ureq::Error::Transport(error)) => Err(transport_failure(error)),
        }
    }
}

fn map_transport(provider: SearchProvider, failure: TransportFailure) -> SearchFailure {
    let kind = match failure {
        TransportFailure::Timeout => FailureKind::Timeout,
        TransportFailure::Network => FailureKind::Network,
        TransportFailure::ResponseTooLarge => FailureKind::ResponseTooLarge,
    };
    SearchFailure::new(provider, kind)
}

#[tauri::command]
pub async fn web_search(
    provider: SearchProvider,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WebResult>, String> {
    tauri::async_runtime::spawn_blocking(move || web_search_blocking(provider, &query, limit))
        .await
        .map_err(|_| "web search worker failed safely; try again.".to_string())?
}

fn web_search_blocking(
    provider: SearchProvider,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<WebResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(vec![]);
    }
    if query.chars().count() > WEB_QUERY_MAX_CHARS {
        return Err("blocked: that search query is far too long to be a search query.".into());
    }
    if crate::secret::blocked_for_remote(query) {
        return Err(
            "blocked: that query carries private content — not sending it to the web.".into(),
        );
    }
    let limit = limit.unwrap_or(5).clamp(1, 10);
    let mut transport = UreqSearchTransport;
    search_with_provider(provider, query, limit, &mut transport)
        .map_err(SearchFailure::user_message)
}

fn search_with_provider(
    provider: SearchProvider,
    query: &str,
    limit: usize,
    transport: &mut impl SearchTransport,
) -> Result<Vec<WebResult>, SearchFailure> {
    match provider {
        SearchProvider::Duckduckgo => duckduckgo_search(query, limit, transport),
        SearchProvider::Brave => {
            let key = crate::keychain::get_secret(crate::keychain::BRAVE_SEARCH_API_KEY_ACCOUNT);
            brave_search(query, limit, key.as_deref(), transport)
        }
    }
}

#[derive(Clone, Copy)]
enum DuckEndpoint {
    Lite,
    Html,
}

fn ddg_request(endpoint: DuckEndpoint, query: &str) -> SearchRequest {
    SearchRequest {
        url: match endpoint {
            DuckEndpoint::Lite => DDG_LITE_URL,
            DuckEndpoint::Html => DDG_HTML_URL,
        },
        query: vec![("q", query.to_string())],
        headers: vec![("Accept-Language", "en-US,en;q=0.9".to_string())],
    }
}

fn duckduckgo_search(
    query: &str,
    limit: usize,
    transport: &mut impl SearchTransport,
) -> Result<Vec<WebResult>, SearchFailure> {
    let provider = SearchProvider::Duckduckgo;
    let lite = transport
        .get(ddg_request(DuckEndpoint::Lite, query))
        .map_err(|failure| map_transport(provider, failure))?;
    match parse_ddg_response(DuckEndpoint::Lite, lite) {
        Ok(mut results) => {
            results.truncate(limit);
            Ok(results)
        }
        // Same provider, second supported page shape. This is resilience inside
        // DuckDuckGo, never a destination-changing provider fallback.
        Err(SearchFailure {
            kind: FailureKind::Incompatible,
            ..
        }) => {
            let html = transport
                .get(ddg_request(DuckEndpoint::Html, query))
                .map_err(|failure| map_transport(provider, failure))?;
            let mut results = parse_ddg_response(DuckEndpoint::Html, html)?;
            results.truncate(limit);
            Ok(results)
        }
        Err(error) => Err(error),
    }
}

fn ddg_challenge(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    [
        "anomaly-modal",
        "challenge-form",
        "verify you are human",
        "bots use duckduckgo",
        "captcha",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn ddg_no_results(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    [
        "class=\"no-results\"",
        "class='no-results'",
        "no results found",
        "did not match any documents",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn parse_ddg_response(
    endpoint: DuckEndpoint,
    response: SearchResponse,
) -> Result<Vec<WebResult>, SearchFailure> {
    let provider = SearchProvider::Duckduckgo;
    if ddg_challenge(&response.body) {
        return Err(SearchFailure::new(provider, FailureKind::Challenge));
    }
    if response.status != 200 {
        return Err(SearchFailure::new(
            provider,
            FailureKind::Upstream(response.status),
        ));
    }
    let results = match endpoint {
        DuckEndpoint::Lite => parse_lite(&response.body),
        DuckEndpoint::Html => parse_html(&response.body),
    };
    if !results.is_empty() || ddg_no_results(&response.body) {
        return Ok(results);
    }
    Err(SearchFailure::new(provider, FailureKind::Incompatible))
}

fn brave_request(query: &str, limit: usize, key: &str) -> SearchRequest {
    SearchRequest {
        url: BRAVE_WEB_URL,
        query: vec![
            ("q", query.to_string()),
            ("count", limit.to_string()),
            ("result_filter", "web".to_string()),
            ("text_decorations", "false".to_string()),
        ],
        headers: vec![
            ("Accept", "application/json".to_string()),
            ("X-Subscription-Token", key.to_string()),
        ],
    }
}

fn brave_search(
    query: &str,
    limit: usize,
    key: Option<&str>,
    transport: &mut impl SearchTransport,
) -> Result<Vec<WebResult>, SearchFailure> {
    let provider = SearchProvider::Brave;
    let key = key
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .ok_or_else(|| SearchFailure::new(provider, FailureKind::MissingKey))?;
    let response = transport
        .get(brave_request(query, limit, key))
        .map_err(|failure| map_transport(provider, failure))?;
    parse_brave_response(response, limit)
}

#[derive(Deserialize)]
struct BravePayload {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    web: Option<BraveWeb>,
}

#[derive(Deserialize)]
struct BraveWeb {
    results: Vec<BraveResult>,
}

#[derive(Deserialize)]
struct BraveResult {
    title: String,
    url: String,
    description: String,
}

fn parse_brave_response(
    response: SearchResponse,
    limit: usize,
) -> Result<Vec<WebResult>, SearchFailure> {
    let provider = SearchProvider::Brave;
    match response.status {
        200 => {}
        401 | 403 => return Err(SearchFailure::new(provider, FailureKind::Unauthorized)),
        429 => return Err(SearchFailure::new(provider, FailureKind::RateLimited)),
        status => return Err(SearchFailure::new(provider, FailureKind::Upstream(status))),
    }
    let payload: BravePayload = serde_json::from_str(&response.body)
        .map_err(|_| SearchFailure::new(provider, FailureKind::Malformed))?;
    if payload.kind != "search" {
        return Err(SearchFailure::new(provider, FailureKind::Malformed));
    }
    let raw = payload.web.map(|web| web.results).unwrap_or_default();
    let had_results = !raw.is_empty();
    let results: Vec<WebResult> = raw
        .into_iter()
        .filter_map(|result| {
            normalize_result(provider, result.title, result.url, result.description)
        })
        .take(limit)
        .collect();
    if had_results && results.is_empty() {
        return Err(SearchFailure::new(provider, FailureKind::Malformed));
    }
    Ok(results)
}

fn normalize_result(
    provider: SearchProvider,
    title: String,
    url: String,
    snippet: String,
) -> Option<WebResult> {
    let title = title.trim();
    let url = url.trim();
    if title.is_empty() || url.chars().count() > RESULT_URL_MAX_CHARS {
        return None;
    }
    let parsed = Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    Some(WebResult {
        provider,
        title: truncate_chars(title, RESULT_TITLE_MAX_CHARS),
        url: url.to_string(),
        snippet: truncate_chars(snippet.trim(), RESULT_SNIPPET_MAX_CHARS),
    })
}

fn parse_lite(html: &str) -> Vec<WebResult> {
    let link_re =
        Regex::new(r#"(?is)<a\b([^>]*?)href=["']([^"']+)["']([^>]*?)>(.*?)</a>"#).unwrap();
    let snip_re =
        Regex::new(r#"(?is)<td[^>]*class=["']result-snippet["'][^>]*>(.*?)</td>"#).unwrap();
    let snippets: Vec<String> = snip_re
        .captures_iter(html)
        .map(|c| clean_text(&c[1]))
        .collect();
    let mut out = Vec::new();
    for capture in link_re.captures_iter(html) {
        let attrs = format!("{} {}", &capture[1], &capture[3]);
        if !attrs.contains("result-link") {
            continue;
        }
        let index = out.len();
        if let Some(result) = normalize_result(
            SearchProvider::Duckduckgo,
            clean_text(&capture[4]),
            capture[2].trim().to_string(),
            snippets.get(index).cloned().unwrap_or_default(),
        ) {
            out.push(result);
        }
    }
    out
}

fn parse_html(html: &str) -> Vec<WebResult> {
    let link_re =
        Regex::new(r#"(?is)<a\b([^>]*?class=["']result__a["'][^>]*?)>(.*?)</a>"#).unwrap();
    let href_re = Regex::new(r#"href=["']([^"']+)["']"#).unwrap();
    let snip_re = Regex::new(r#"(?is)class=["']result__snippet["'][^>]*>(.*?)</a>"#).unwrap();
    let snippets: Vec<String> = snip_re
        .captures_iter(html)
        .map(|c| clean_text(&c[1]))
        .collect();
    let mut out = Vec::new();
    for capture in link_re.captures_iter(html) {
        let href = href_re
            .captures(&capture[1])
            .map(|matched| matched[1].to_string())
            .unwrap_or_default();
        let index = out.len();
        if let Some(result) = normalize_result(
            SearchProvider::Duckduckgo,
            clean_text(&capture[2]),
            unwrap_ddg_redirect(&href),
            snippets.get(index).cloned().unwrap_or_default(),
        ) {
            out.push(result);
        }
    }
    out
}

fn unwrap_ddg_redirect(href: &str) -> String {
    if let Some(index) = href.find("uddg=") {
        let encoded = href[index + 5..].split('&').next().unwrap_or("");
        return percent_decode(encoded);
    }
    if href.starts_with("//") {
        return format!("https:{href}");
    }
    href.to_string()
}

fn strip_tags(value: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<[^>]+>").unwrap())
        .replace_all(value, "")
        .to_string()
}

fn clean_text(value: &str) -> String {
    decode_entities(&strip_tags(value))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                match (hex_val(bytes[index + 1]), hex_val(bytes[index + 2])) {
                    (Some(high), Some(low)) => {
                        out.push(high * 16 + low);
                        index += 3;
                    }
                    _ => {
                        out.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeTransport {
        replies: std::collections::VecDeque<Result<SearchResponse, TransportFailure>>,
        requests: Vec<SearchRequest>,
    }

    impl FakeTransport {
        fn with(replies: Vec<Result<SearchResponse, TransportFailure>>) -> Self {
            Self {
                replies: replies.into(),
                requests: Vec::new(),
            }
        }
    }

    impl SearchTransport for FakeTransport {
        fn get(&mut self, request: SearchRequest) -> Result<SearchResponse, TransportFailure> {
            self.requests.push(request);
            self.replies.pop_front().expect("fake response")
        }
    }

    fn response(status: u16, body: &str) -> Result<SearchResponse, TransportFailure> {
        Ok(SearchResponse {
            status,
            body: body.to_string(),
        })
    }

    #[test]
    fn duckduckgo_normalizes_lite_results() {
        let body = r#"<table>
          <tr><td><a rel="nofollow" href="https://www.rust-lang.org/" class="result-link">Rust Programming Language</a></td></tr>
          <tr><td class="result-snippet">A language empowering everyone to build reliable software.</td></tr>
        </table>"#;
        let mut transport = FakeTransport::with(vec![response(200, body)]);
        let results = duckduckgo_search("rust", 5, &mut transport).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].provider, SearchProvider::Duckduckgo);
        assert_eq!(results[0].url, "https://www.rust-lang.org/");
    }

    #[test]
    fn duckduckgo_no_results_is_not_a_provider_failure() {
        let mut transport = FakeTransport::with(vec![response(
            200,
            r#"<html><div class="no-results">No results found</div></html>"#,
        )]);
        assert_eq!(
            duckduckgo_search("unfindable", 5, &mut transport).unwrap(),
            vec![]
        );
        assert_eq!(transport.requests.len(), 1);
    }

    #[test]
    fn duckduckgo_challenge_and_parser_incompatibility_are_distinct() {
        let challenge = parse_ddg_response(
            DuckEndpoint::Lite,
            SearchResponse {
                status: 200,
                body: "<form class=\"challenge-form\">Verify you are human</form>".into(),
            },
        )
        .unwrap_err();
        assert_eq!(challenge.kind, FailureKind::Challenge);

        let incompatible = parse_ddg_response(
            DuckEndpoint::Html,
            SearchResponse {
                status: 200,
                body: "<html><p>new markup</p></html>".into(),
            },
        )
        .unwrap_err();
        assert_eq!(incompatible.kind, FailureKind::Incompatible);
    }

    #[test]
    fn duckduckgo_network_timeout_and_http_failure_are_distinct() {
        let mut timeout = FakeTransport::with(vec![Err(TransportFailure::Timeout)]);
        assert_eq!(
            duckduckgo_search("rust", 5, &mut timeout).unwrap_err().kind,
            FailureKind::Timeout
        );
        let mut upstream = FakeTransport::with(vec![response(503, "unavailable")]);
        assert_eq!(
            duckduckgo_search("rust", 5, &mut upstream)
                .unwrap_err()
                .kind,
            FailureKind::Upstream(503)
        );
    }

    #[test]
    fn brave_normalizes_official_web_result_shape_and_authenticates_in_a_header() {
        let body = r#"{
          "type":"search",
          "query":{"original":"rust"},
          "web":{"type":"search","results":[{
            "title":"Rust Programming Language",
            "url":"https://www.rust-lang.org/",
            "description":"Reliable and efficient software."
          }]}
        }"#;
        let mut transport = FakeTransport::with(vec![response(200, body)]);
        let results = brave_search("rust", 5, Some("test-key"), &mut transport).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].provider, SearchProvider::Brave);
        let request = &transport.requests[0];
        assert_eq!(request.url, BRAVE_WEB_URL);
        assert!(request
            .headers
            .iter()
            .any(|(name, value)| *name == "X-Subscription-Token" && value == "test-key"));
        assert!(!request.query.iter().any(|(_, value)| value == "test-key"));
    }

    #[test]
    fn brave_missing_key_never_starts_a_request() {
        let mut transport = FakeTransport::default();
        let error = brave_search("rust", 5, None, &mut transport).unwrap_err();
        assert_eq!(error.kind, FailureKind::MissingKey);
        let message = error.user_message();
        assert!(message.contains("Settings → Connections → Web research"));
        assert!(!message.contains("AI Models"));
        assert!(transport.requests.is_empty());
    }

    #[test]
    fn brave_auth_quota_timeout_and_malformed_fail_distinctly() {
        for status in [401, 403] {
            let error = parse_brave_response(
                SearchResponse {
                    status,
                    body: "{}".into(),
                },
                5,
            )
            .unwrap_err();
            assert_eq!(error.kind, FailureKind::Unauthorized);
        }
        let quota = parse_brave_response(
            SearchResponse {
                status: 429,
                body: "{}".into(),
            },
            5,
        )
        .unwrap_err();
        assert_eq!(quota.kind, FailureKind::RateLimited);

        let malformed = parse_brave_response(
            SearchResponse {
                status: 200,
                body: "not json".into(),
            },
            5,
        )
        .unwrap_err();
        assert_eq!(malformed.kind, FailureKind::Malformed);

        let mut timeout = FakeTransport::with(vec![Err(TransportFailure::Timeout)]);
        let error = brave_search("rust", 5, Some("key"), &mut timeout).unwrap_err();
        assert_eq!(error.kind, FailureKind::Timeout);
    }

    #[test]
    fn brave_failure_never_falls_back_to_duckduckgo() {
        let mut transport = FakeTransport::with(vec![response(429, "{}")]);
        let error = brave_search("rust", 5, Some("key"), &mut transport).unwrap_err();
        assert_eq!(error.kind, FailureKind::RateLimited);
        assert_eq!(transport.requests.len(), 1);
        assert_eq!(transport.requests[0].url, BRAVE_WEB_URL);
    }

    #[test]
    fn search_guards_apply_before_either_provider_dispatches() {
        let secret = "here is my key sk-ant-api03-EXAMPLE0EXAMPLE0EXAM please search";
        for provider in [SearchProvider::Duckduckgo, SearchProvider::Brave] {
            let error = web_search_blocking(provider, secret, None).unwrap_err();
            assert!(error.contains("blocked"));
        }

        let secure_body =
            "The Widdershins harbor acquisition closes after the vernal inventory audit.";
        let private_query = "harbor acquisition closes after the vernal inventory";
        crate::secret::remember_secure_text(secure_body);
        for provider in [SearchProvider::Duckduckgo, SearchProvider::Brave] {
            let error = web_search_blocking(provider, private_query, None).unwrap_err();
            assert!(error.contains("blocked"));
        }
    }

    #[test]
    fn over_long_queries_are_refused_for_every_provider() {
        let query = "lorem ".repeat(200);
        assert!(query.chars().count() > WEB_QUERY_MAX_CHARS);
        for provider in [SearchProvider::Duckduckgo, SearchProvider::Brave] {
            let error = web_search_blocking(provider, &query, Some(5)).unwrap_err();
            assert!(error.contains("too long"));
        }
    }

    #[test]
    fn provider_destinations_match_the_mechanical_egress_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../scripts/fixtures/egress-fixtures.json"
        )))
        .unwrap();
        let providers = fixture["searchProviders"].as_array().unwrap();
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0]["provider"], "duckduckgo");
        assert_eq!(providers[0]["default"], true);
        assert_eq!(providers[0]["endpoints"][0], DDG_LITE_URL);
        assert_eq!(providers[0]["endpoints"][1], DDG_HTML_URL);
        assert_eq!(providers[1]["provider"], "brave");
        assert_eq!(providers[1]["default"], false);
        assert_eq!(providers[1]["endpoints"][0], BRAVE_WEB_URL);
    }

    #[test]
    fn a_timeout_while_reading_the_response_body_stays_a_timeout() {
        struct TimedOutReader;
        impl Read for TimedOutReader {
            fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::TimedOut, "fixture timeout"))
            }
        }
        assert_eq!(
            read_search_body(TimedOutReader).unwrap_err(),
            TransportFailure::Timeout
        );
    }
}
