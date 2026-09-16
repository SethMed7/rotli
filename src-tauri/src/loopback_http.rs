//! Loopback HTTP primitives, defined once.
//!
//! Two adapters in this crate speak HTTP over the loopback interface: the
//! authenticated MCP adapter (`rotli mcp --http`, `workspace.rs`) and the
//! standalone `rotli-helper` bridge (`helper.rs`). Both read a bounded request
//! head, compare a bearer token in constant time, and answer with one JSON
//! document. Duplicating any of that would mean two places to get a credential
//! boundary wrong, so it lives here.

use std::io::{BufRead, Read, Write};
use std::net::TcpStream;

use serde_json::Value;

/// A request head is bounded before a body is read at all: a client must not be
/// able to stream headers forever, nor hide a megabyte in one of them.
const MAX_HEADER_LINES: usize = 64;
const MAX_HEADER_LINE_BYTES: u64 = 8 * 1024;

pub(crate) struct HttpHead {
    pub(crate) method: String,
    pub(crate) path: String,
    /// `(lowercased name, trimmed value)` in wire order.
    headers: Vec<(String, String)>,
}

impl HttpHead {
    /// `name` must already be lowercase — header names are case-insensitive and
    /// normalized on the way in.
    pub(crate) fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(candidate, _)| candidate == name)
            .map(|(_, value)| value.as_str())
    }
}

/// Read the request line and headers, bounded in both count and width.
pub(crate) fn read_http_head(reader: &mut impl BufRead) -> Result<HttpHead, String> {
    let first = read_bounded_line(reader)?;
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = Vec::new();
    loop {
        let line = read_bounded_line(reader)?;
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        if headers.len() >= MAX_HEADER_LINES {
            return Err(format!("more than {MAX_HEADER_LINES} request headers"));
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
        }
    }
    Ok(HttpHead { method, path, headers })
}

fn read_bounded_line(reader: &mut impl BufRead) -> Result<String, String> {
    let mut line = String::new();
    let read = reader
        .by_ref()
        .take(MAX_HEADER_LINE_BYTES)
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    if read as u64 == MAX_HEADER_LINE_BYTES && !line.ends_with('\n') {
        return Err("a request header exceeds the 8 KB limit".into());
    }
    Ok(line)
}

/// The two refusals both loopback adapters answer with. Spelled once so the
/// wire vocabulary of the credential boundary has one home.
pub(crate) fn unauthorized() -> Value {
    serde_json::json!({"error": "unauthorized"})
}

pub(crate) fn not_found() -> Value {
    serde_json::json!({"error": "not found"})
}

/// Does this request carry the expected bearer? The header name and the
/// constant-time compare belong together and to neither adapter in particular.
pub(crate) fn bearer_authorized(head: &HttpHead, token: &str) -> bool {
    head.header("authorization").is_some_and(|value| valid_bearer(value, token))
}

/// Read the body a request head declares. Both loopback adapters bound it the
/// same way and so must not each spell out the rule: a declared length is
/// required, a length over the caller's cap is refused BEFORE a byte is read or
/// allocated, and the body is then read exactly. On refusal the caller gets the
/// status and the JSON document to answer with.
pub(crate) fn read_http_body(
    reader: &mut impl BufRead,
    head: &HttpHead,
    max_bytes: usize,
) -> Result<Vec<u8>, (u16, Value)> {
    let declared = head.header("content-length").and_then(|value| value.trim().parse::<usize>().ok());
    let Some(length) = declared else {
        return Err((411, serde_json::json!({"error": "content-length required"})));
    };
    if length > max_bytes {
        return Err((413, serde_json::json!({"error": "request too large"})));
    }
    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| (400, serde_json::json!({"error": error.to_string()})))?;
    Ok(body)
}

/// Compare the complete Authorization value in time determined by the expected
/// token, not by the first mismatching byte. A loopback adapter is still a
/// credential boundary even though it cannot bind a LAN address.
pub(crate) fn valid_bearer(value: &str, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    let actual = value.as_bytes();
    let mut difference = expected.len() ^ actual.len();
    for (index, byte) in expected.bytes().enumerate() {
        difference |= usize::from(byte ^ actual.get(index).copied().unwrap_or_default());
    }
    difference == 0
}

pub(crate) fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    body: Option<Value>,
) -> Result<(), String> {
    write_http_response_with_headers(stream, status, &[], body)
}

/// `extra` carries the response headers a caller adds per request — in practice
/// the helper's CORS set, which must ride EVERY answer to an allowlisted origin
/// (including the failures) or the browser cannot read the error body.
pub(crate) fn write_http_response_with_headers(
    stream: &mut TcpStream,
    status: u16,
    extra: &[(&str, String)],
    body: Option<Value>,
) -> Result<(), String> {
    let encoded = body
        .map(|value| serde_json::to_vec(&value).map_err(|error| error.to_string()))
        .transpose()?;
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    for (name, value) in extra {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    match &encoded {
        // 204 carries no representation at all — not even a zero length.
        _ if status == 204 => {}
        Some(bytes) => head.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            bytes.len()
        )),
        None => head.push_str("Content-Type: application/json\r\nContent-Length: 0\r\n"),
    }
    head.push_str("Connection: close\r\n\r\n");
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(encoded.as_deref().unwrap_or_default()))
        .and_then(|_| stream.flush())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The compare is length- AND content-sensitive: a one-character change and
    /// a valid PREFIX plus extra must both fail, or a token is guessable.
    #[test]
    fn a_bearer_matches_only_the_whole_token() {
        let token = "fixture-token-with-24-chars";
        assert!(valid_bearer("Bearer fixture-token-with-24-chars", token));
        assert!(!valid_bearer("Bearer fixture-token-with-24-charx", token));
        assert!(!valid_bearer("Bearer fixture-token-with-24-chars-extra", token));
        assert!(!valid_bearer("fixture-token-with-24-chars", token));
        assert!(!valid_bearer("", token));
    }
}
