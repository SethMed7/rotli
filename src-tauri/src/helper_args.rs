//! Rotli Helper's command line: `rotli-helper [--port N] [--origin URL]...
//! [--print-code] [--reset-token]`. Pure parsing; the service lives in helper.rs.

pub(crate) const DEFAULT_PORT: u16 = 43111;
pub(crate) const DEFAULT_ORIGINS: &[&str] = &[
    "https://rotli.co",
    "https://dev.rotli.co",
    "http://localhost:1437",
    "http://127.0.0.1:1437",
];
const USAGE: &str = "rotli-helper [--port N] [--origin URL]... [--print-code] [--reset-token]";
pub(crate) struct Options {
    pub(crate) port: u16,
    pub(crate) origins: Vec<String>,
    pub(crate) print_code: bool,
    pub(crate) reset_token: bool,
}

pub(crate) fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut options = Options {
        port: DEFAULT_PORT,
        origins: DEFAULT_ORIGINS.iter().map(|origin| (*origin).to_string()).collect(),
        print_code: false,
        reset_token: false,
    };
    let mut index = 0;
    while index < args.len() {
        let value = |at: usize, what: &str| {
            args.get(at + 1).cloned().ok_or(format!("{what} needs a value\n{USAGE}"))
        };
        match args[index].as_str() {
            "--port" => {
                options.port = value(index, "--port")?
                    .parse()
                    .map_err(|_| format!("--port must be a TCP port number\n{USAGE}"))?;
                index += 1;
            }
            "--origin" => {
                options.origins.push(normalize_origin(&value(index, "--origin")?));
                index += 1;
            }
            "--print-code" => options.print_code = true,
            "--reset-token" => options.reset_token = true,
            // asking for help is not an error
            "--help" | "-h" => { println!("{USAGE}"); std::process::exit(0) }
            other => return Err(format!("unknown option \"{other}\"\n{USAGE}")),
        }
        index += 1;
    }
    Ok(options)
}

/// Origins compare exactly, so both sides are normalized the way a browser
/// writes one: lowercase, no trailing slash, no path.
pub(crate) fn normalize_origin(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_parse_into_the_documented_options() {
        let typed = ["--port", "43999", "--origin", "https://Example.test/", "--print-code"];
        let parsed = parse_args(&typed.map(String::from)).unwrap();
        assert_eq!(parsed.port, 43999);
        assert!(parsed.print_code);
        assert!(parsed.origins.contains(&"https://example.test".to_string()));
        assert!(parsed.origins.contains(&"https://rotli.co".to_string()));
        assert!(parse_args(&["--nope".into()]).is_err());
        assert!(parse_args(&["--port".into()]).is_err());
    }
}
