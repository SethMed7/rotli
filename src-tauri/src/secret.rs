//! The secret-pattern detector — the SINGLE source of truth for "does this text
//! hold a secret?". Two callers share it:
//!   • corpus.rs — auto-flags a note `secure: true` (never sent to a remote model,
//!     gitignored) when its body trips a pattern.
//!   • web.rs — the egress backstop: a secret must never ride a web request off the
//!     machine, so an outbound search query / URL is checked here first.
//! One regex set, one place (Seth, 2026-06-29).

use std::sync::OnceLock;

/// High-signal secret patterns — API keys, private keys, JWTs, SSNs, card numbers.
/// ANY match → the text holds secrets.
pub fn looks_secure(text: &str) -> bool {
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let pats = PATTERNS.get_or_init(|| {
        [
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
            r"-----BEGIN PGP",
            r"sk-ant-[A-Za-z0-9_-]{16}",
            r"\b(?:sk|pk|rk)_[A-Za-z0-9]{20}",
            r"github_pat_[A-Za-z0-9_]{20}",
            r"\bgh[posru]_[A-Za-z0-9]{20}",
            r"AIza[A-Za-z0-9_-]{20}",
            r"\bxox[baprs]-[A-Za-z0-9-]{10}",
            r"whsec_[A-Za-z0-9+/]{16}",
            r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}",
            r"\b\d{3}-\d{2}-\d{4}\b",
            r"\b\d{4}[ -]\d{6}[ -]\d{5}\b",
            r"\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b",
        ]
        .iter()
        .filter_map(|p| regex::Regex::new(p).ok())
        .collect()
    });
    pats.iter().any(|re| re.is_match(text))
}
