//! The secret-pattern detector — the Rust source of truth for "does this text
//! hold a secret?". Three Rust callers share it:
//!   • corpus.rs — auto-flags a note `secure: true` (never sent to a remote model,
//!     gitignored) when its body trips a pattern.
//!   • web.rs — the egress backstop: a secret must never ride a web request off the
//!     machine, so an outbound search query / URL is checked here first.
//!   • chat.rs — the model-egress backstop: a secret-shaped transcript is refused
//!     to any NON-local endpoint before `chat_messages` posts it.
//! NOTE: `src/ai/guard.ts` is a hand-maintained TS MIRROR of these patterns — the
//! frontend can't reach into Rust, so the two sets are duplicated ON PURPOSE and
//! must be kept in sync by hand: change a pattern here, change it there too
//! (Seth, 2026-06-29).

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
    if pats.iter().any(|re| re.is_match(text)) {
        return true;
    }
    // UNSEPARATED card numbers (#23, audit 2026-07): "4242424242424242" has no
    // dashes/spaces and skipped every pattern above. A bare 15–16 digit run is
    // too common (ids, phone-ish strings) to flag on shape alone, so each
    // candidate must ALSO pass Luhn — the checksum every real PAN carries.
    // (`\b` never splits two word chars, so a digit run inside a ULID is safe.)
    static PAN: OnceLock<regex::Regex> = OnceLock::new();
    let pan = PAN.get_or_init(|| regex::Regex::new(r"\b\d{15,16}\b").expect("valid PAN regex"));
    pan.find_iter(text).any(|m| luhn_ok(m.as_str()))
}

/// Final remote-egress backstop. A secure note read includes its managed
/// frontmatter marker, so a future read/send model mismatch still cannot
/// forward ordinary (non-secret-shaped) private prose.
pub fn protected_for_remote(text: &str) -> bool {
    looks_secure(text)
        || text.lines().any(|line| {
            let line = line.trim();
            // ANY local_ai_allowed decision — true OR false — only ever appears
            // on a secure note (set_local_ai_access refuses to write it
            // elsewhere), so both values mark the text as protected (2026-08-01:
            // the bit became tri-state when local visibility became the default).
            line == "secure: true" || line.starts_with("local_ai_allowed:")
        })
}

/// The Luhn checksum over an all-digit candidate — true when it checks out
/// (i.e. the run is shaped like a real card number).
fn luhn_ok(digits: &str) -> bool {
    let mut sum = 0u32;
    let mut double = false;
    for c in digits.chars().rev() {
        let Some(mut d) = c.to_digit(10) else { return false };
        if double {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
        double = !double;
    }
    sum.is_multiple_of(10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separated_pans_and_ssns_still_trip() {
        assert!(looks_secure("card: 4242 4242 4242 4242"));
        assert!(looks_secure("card: 4242-4242-4242-4242"));
        assert!(looks_secure("ssn: 123-45-6789"));
        assert!(looks_secure("amex: 3782-822463-10005"));
    }

    #[test]
    fn unseparated_pans_trip_only_when_luhn_valid() {
        // the exact shape from the migrated notes (#23)
        assert!(looks_secure("card 4242424242424242 exp 12/28"));
        assert!(looks_secure("amex 371449635398431")); // 15-digit, Luhn-valid
        // 16 digits that fail Luhn — an id, not a card
        assert!(!looks_secure("order 1234567890123456"));
        // digit runs glued to word chars never match (\b) — ULIDs etc. are safe
        assert!(!looks_secure("id a4242424242424242z"));
        // too short / too long runs don't match the PAN shape
        assert!(!looks_secure("n 42424242424242"));
        assert!(!looks_secure("n 42424242424242424242"));
    }

    #[test]
    fn plain_text_is_clean() {
        assert!(!looks_secure("a grocery list: eggs, milk, 12 apples"));
    }

    #[test]
    fn secure_note_markers_are_protected_at_remote_egress() {
        assert!(protected_for_remote("---\nsecure: true\n---\nCall notes"));
        assert!(protected_for_remote("local_ai_allowed: true\nordinary prose"));
        // the DENY value marks a secure note just as surely as the allow value
        assert!(protected_for_remote("local_ai_allowed: false\nordinary prose"));
        assert!(!protected_for_remote("ordinary prose about security"));
    }
}
