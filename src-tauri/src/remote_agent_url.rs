//! Relay URL and retry policy for the remote-agent connector: HTTPS only
//! (loopback HTTP for development), no query, fragment, or credentials; an
//! unreachable relay is retried on a capped exponential backoff. Pure; tested
//! below and through `remote_agent.rs`.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// First retry after a failed poll; doubles per consecutive failure up to the cap.
pub(crate) const RELAY_RETRY_MIN: Duration = Duration::from_secs(2);
const RELAY_RETRY_MAX: Duration = Duration::from_secs(60);
/// The relay holds each poll ~25 s; an idle reply faster than this never loops hot.
pub(crate) const RELAY_MIN_POLL_GAP: Duration = Duration::from_secs(1);

pub(crate) fn next_relay_retry(current: Duration) -> Duration {
    current.saturating_mul(2).min(RELAY_RETRY_MAX)
}

/// Sleep in short slices so a disconnect stays prompt during a long backoff.
pub(crate) fn sleep_unless_stopped(stop: &AtomicBool, total: Duration) {
    let slice = Duration::from_millis(100);
    let mut left = total;
    while !left.is_zero() && !stop.load(Ordering::Acquire) {
        let step = left.min(slice);
        std::thread::sleep(step);
        left -= step;
    }
}
pub(crate) fn relay_base(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    let base = value.strip_suffix("/mcp").unwrap_or(value);
    let parsed = tauri::Url::parse(base).map_err(|_| "enter a valid relay HTTPS URL")?;
    let local_dev = parsed.scheme() == "http"
        && parsed
            .host_str()
            // an IPv6 host comes back in brackets ("[::1]"), never bare
            .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "[::1]"));
    if parsed.scheme() != "https" && !local_dev {
        return Err(
            "the relay must use HTTPS (HTTP is allowed only on loopback for development)".into(),
        );
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("the relay URL must not contain a query or fragment".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("the relay URL must not contain credentials".into());
    }
    Ok(base.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_retries_double_from_two_seconds_to_a_one_minute_cap() {
        let mut d = RELAY_RETRY_MIN;
        let mut schedule = vec![d.as_secs()];
        for _ in 0..7 {
            d = next_relay_retry(d);
            schedule.push(d.as_secs());
        }
        assert_eq!(schedule, [2, 4, 8, 16, 32, 60, 60, 60]);
    }

    #[test]
    fn a_stopped_connector_does_not_sit_out_its_backoff() {
        let stop = AtomicBool::new(true);
        let t = std::time::Instant::now();
        sleep_unless_stopped(&stop, Duration::from_secs(60));
        assert!(t.elapsed() < Duration::from_millis(50));
    }

    #[test]
    fn https_relays_pass_and_keep_their_base() {
        assert_eq!(relay_base("https://relay.example/mcp/").unwrap(), "https://relay.example");
        assert_eq!(relay_base(" https://relay.example ").unwrap(), "https://relay.example");
    }

    // 2026-09-27: `host_str()` gives an IPv6 host in brackets, so a bare "::1"
    // never matched and http on the IPv6 loopback was refused.
    #[test]
    fn plain_http_passes_only_on_loopback_including_ipv6() {
        for ok in ["http://127.0.0.1:9911/mcp", "http://localhost:9911", "http://[::1]:9911/mcp"] {
            assert!(relay_base(ok).is_ok(), "{ok} should be allowed for development");
        }
        for bad in ["http://relay.test/mcp", "http://10.0.0.5:9911", "ftp://relay.test"] {
            assert!(relay_base(bad).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn credentials_queries_and_fragments_are_refused() {
        for bad in [
            "https://user:secret@relay.example/mcp",
            "https://user@relay.example",
            "https://relay.example/mcp?token=1",
            "https://relay.example#frag",
            "not a url",
        ] {
            assert!(relay_base(bad).is_err(), "{bad} must be refused");
        }
    }
}
