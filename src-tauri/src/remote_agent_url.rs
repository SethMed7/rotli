//! Relay URL policy for the remote-agent connector: HTTPS only (loopback HTTP
//! for development), no query, fragment, or credentials. Pure; tested through
//! `remote_agent.rs`.
pub(crate) fn relay_base(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    let base = value.strip_suffix("/mcp").unwrap_or(value);
    let parsed = tauri::Url::parse(base).map_err(|_| "enter a valid relay HTTPS URL")?;
    let local_dev = parsed.scheme() == "http"
        && parsed
            .host_str()
            .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1"));
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
