//! Relay URL policy for the remote-agent connector: HTTPS only (loopback HTTP
//! for development), no query, fragment, or credentials. Pure; tested below
//! and through `remote_agent.rs`.
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
    use super::relay_base;

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
