//! Loopback HTTP primitives, defined once.
//!
//! Two adapters in this crate speak HTTP over the loopback interface: the
//! authenticated MCP adapter (`rotli mcp --http`, `workspace.rs`) and the
//! standalone `rotli-helper` bridge (`helper.rs`). Both read a bounded request
//! head, compare a bearer token in constant time, and answer with one JSON
//! document. Duplicating any of that would mean two places to get a credential
//! boundary wrong, so it lives here.

use std::io::{BufRead, ErrorKind, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use serde_json::Value;

/// A request head is bounded before a body is read at all: a client must not be
/// able to stream headers forever, nor hide a megabyte in one of them, nor hold
/// a connection slot by dribbling.
const MAX_HEADER_LINES: usize = 64;
const MAX_HEADER_LINE_BYTES: u64 = 8 * 1024;
/// ABSOLUTE, measured from the first read. A socket read timeout restarts on
/// every byte that arrives, so one byte every nine seconds satisfies it forever;
/// only a deadline that does not move bounds a slowloris.
const HEAD_DEADLINE: Duration = Duration::from_secs(10);

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

/// Read the request line and headers, bounded in count, width, and time. The
/// caller answers 400 on any refusal.
pub(crate) fn read_http_head(reader: &mut impl BufRead) -> Result<HttpHead, String> {
    let deadline = Instant::now() + HEAD_DEADLINE;
    let first = read_bounded_line(reader)?;
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = Vec::new();
    // EVERY line counts against the cap. Counting only the well-formed ones let
    // an endless flood of junk lines run unbounded past it.
    for _ in 0..MAX_HEADER_LINES {
        if Instant::now() >= deadline {
            return Err("the request head took longer than 10s".into());
        }
        let line = read_bounded_line(reader)?;
        if line == "\r\n" || line == "\n" || line.is_empty() {
            return Ok(HttpHead {
                method,
                path,
                headers,
            });
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err("a request head line is not a header".into());
        };
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
    Err(format!("more than {MAX_HEADER_LINES} request head lines"))
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

/// A head that never became a request. Answered rather than dropped, so a
/// client learns it was refused instead of seeing a reset connection.
pub(crate) fn malformed_head() -> Value {
    serde_json::json!({"error": "malformed request head"})
}

/// Does this request carry the expected bearer? The header name and the
/// constant-time compare belong together and to neither adapter in particular.
pub(crate) fn bearer_authorized(head: &HttpHead, token: &str) -> bool {
    head.header("authorization")
        .is_some_and(|value| valid_bearer(value, token))
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
    let declared = head
        .header("content-length")
        .and_then(|value| value.trim().parse::<usize>().ok());
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

/// Read and discard the body a refused request declared, up to `max_bytes`.
/// A refusal written while that body is still unread closes the socket on
/// pending data; the kernel then resets the connection and the browser reports
/// a network error instead of the answer. Every refusal that precedes
/// `read_http_body` drains first. The caller's read timeout still bounds it.
pub(crate) fn drain_http_body(reader: &mut impl BufRead, head: &HttpHead, max_bytes: usize) {
    let declared = head
        .header("content-length")
        .and_then(|value| value.trim().parse::<u64>().ok());
    let length = declared.unwrap_or(0).min(max_bytes as u64);
    let _ = std::io::copy(&mut reader.take(length), &mut std::io::sink());
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
        .or_else(|error| match error.kind() {
            // the peer left before the answer (a page reload, an aborted
            // fetch): nobody is there to tell, and it is not the adapter's error
            ErrorKind::BrokenPipe | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted => {
                Ok(())
            }
            _ => Err(error.to_string()),
        })
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn a_head_is_bounded_in_lines_and_refuses_a_line_that_is_not_a_header() {
        let good = "GET /health HTTP/1.1\r\nHost: localhost:1\r\n\r\n";
        let head = read_http_head(&mut Cursor::new(good.as_bytes())).unwrap();
        assert_eq!(
            (head.method.as_str(), head.path.as_str()),
            ("GET", "/health")
        );
        assert_eq!(head.header("host"), Some("localhost:1"));
        let refusal = |raw: String| {
            read_http_head(&mut Cursor::new(raw.into_bytes()))
                .err()
                .unwrap_or_default()
        };
        let junk = refusal(format!(
            "GET / HTTP/1.1\r\n{}\r\n",
            "nonsense\r\n".repeat(500)
        ));
        assert!(junk.contains("not a header"), "{junk}");
        // a flood of WELL-FORMED headers still stops at the cap
        let many = refusal(format!(
            "GET / HTTP/1.1\r\n{}\r\n",
            "X-Pad: 1\r\n".repeat(500)
        ));
        assert!(many.contains("more than 64"), "{many}");
        let wide = refusal(format!(
            "GET / HTTP/1.1\r\nX-Pad: {}\r\n\r\n",
            "y".repeat(9000)
        ));
        assert!(wide.contains("8 KB"), "{wide}");
    }

    /// The compare is length- AND content-sensitive: a one-character change and
    /// a valid PREFIX plus extra must both fail, or a token is guessable.
    #[test]
    fn a_bearer_matches_only_the_whole_token() {
        let token = "fixture-token-with-24-chars";
        assert!(valid_bearer("Bearer fixture-token-with-24-chars", token));
        assert!(!valid_bearer("Bearer fixture-token-with-24-charx", token));
        assert!(!valid_bearer(
            "Bearer fixture-token-with-24-chars-extra",
            token
        ));
        assert!(!valid_bearer("fixture-token-with-24-chars", token));
        assert!(!valid_bearer("", token));
    }
}
