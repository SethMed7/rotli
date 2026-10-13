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
//! (the maintainer, 2026-06-29).
//!
//! This module also holds the SECURE-PROSE LEDGER (`blocked_for_remote`), the
//! Rust counterpart of `containsPrivateDataOverlap` — see its own section below.

use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

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

/// MARKER backstop. A secure note read includes its managed frontmatter marker,
/// and a secure-tainted CHAT carries `secureContext: true` in its own — so a
/// read/send model mismatch cannot forward marked private prose even when the
/// prose itself is not secret-SHAPED.
///
/// Pure and stateless: this is the "does the text announce itself" half. The
/// other half — prose a secure note actually contributed, which announces
/// nothing — is `echoes_secure_text`. Egress seams call `blocked_for_remote`,
/// which is both.
pub fn protected_for_remote(text: &str) -> bool {
    looks_secure(text) || text.lines().any(|line| marks_protected(line.trim()))
}

/// The frontmatter markers that mean "this text came out of a protected
/// container". Named once so the three of them stay a set, not scattered
/// string compares.
fn marks_protected(line: &str) -> bool {
    // ANY local_ai_allowed decision — true OR false — only ever appears on a
    // secure note (set_local_ai_access refuses to write it elsewhere), so both
    // values mark the text as protected (2026-08-01: the bit became tri-state
    // when local visibility became the default).
    if line == "secure: true" || line.starts_with("local_ai_allowed:") {
        return true;
    }
    // The CHAT taint marker (src/memex/contract.ts `hasSecureContext`): a chat
    // whose transcript was fed by a secure note is stamped `secureContext:
    // true`, permanently. docs/design/ai-visibility-matrix.md T2 step 5 promises
    // Rust refuses such a transcript "regardless" of the TS filter — before
    // 2026-08-01 that promise was only kept in TypeScript (audit: GAP 4).
    line.strip_prefix("secureContext:")
        .is_some_and(|v| v.trim() == "true")
}

// ── the secure-prose ledger ───────────────────────────────────────────────────
//
// The marker scan above and `looks_secure` both need the outbound text to
// ANNOUNCE itself — a credential shape, or a frontmatter line the sender
// forgot to strip. Neither catches the case the visibility matrix actually
// cares about: an on-device model legitimately reads a secure note, and then
// ordinary private prose from it — "the Montreal acquisition closes in Q3" —
// is put in a web-search query, a fetch URL, or a remote model's transcript.
// Nothing about that string is secret-shaped.
//
// `src/ai/guard.ts` has answered this since the 2026-07 audit
// (`containsPrivateDataOverlap`), but only in TypeScript — the webview side of
// the trust boundary, which the threat model assumes compromised. Rust could
// not answer it because Rust had no memory of what the session had READ.
//
// This is that memory: when `read_for_ai` hands a SECURE body to an on-device
// model, its verbatim 5-word phrases are hashed into a process-local ledger.
// Every egress seam then refuses outbound text that echoes one. Nothing is
// persisted, nothing leaves the process, and only hashes are kept — the ledger
// can answer "did this come from a secure note" without holding the note.
//
// MIRROR-NOT-IMPORT of `containsPrivateDataOverlap`: same 5-word window, same
// 24-char floor, same token shape. The verdicts are pinned on both sides by
// `scripts/fixtures/parity.json` → `secureOverlap`. One difference is
// deliberate and documented there: TS normalizes NFKC first and Rust does not
// (no std normalizer), so the fixture cases stay in NFC.

/// Words per verbatim phrase — `PRIVATE_OVERLAP_WORDS` in src/ai/guard.ts.
const OVERLAP_WORDS: usize = 5;
/// A phrase shorter than this is too common to be evidence of anything.
const OVERLAP_MIN_CHARS: usize = 24;
/// FIFO bound on the ledger. ~50k phrases is ~50 average notes' worth; the
/// oldest phrases age out so a long-running app cannot grow without limit and
/// cannot accumulate an ever-widening false-positive surface.
const LEDGER_CAP: usize = 50_000;

struct Ledger {
    seen: HashSet<u64>,
    order: VecDeque<u64>,
}

fn ledger() -> &'static Mutex<Ledger> {
    static LEDGER: OnceLock<Mutex<Ledger>> = OnceLock::new();
    LEDGER.get_or_init(|| {
        Mutex::new(Ledger {
            seen: HashSet::new(),
            order: VecDeque::new(),
        })
    })
}

/// Lowercased prose tokens — mirrors `proseTokens` in src/ai/guard.ts. A token
/// is a letter/digit followed by at least two more letter/digit/apostrophe/
/// hyphen characters, so punctuation, markdown syntax and 1–2 char words drop
/// out and only real words remain to be matched on.
pub(crate) fn prose_tokens(text: &str) -> Vec<String> {
    static TOKEN: OnceLock<regex::Regex> = OnceLock::new();
    let re = TOKEN.get_or_init(|| {
        regex::Regex::new(r"[\p{L}\p{N}][\p{L}\p{N}'\u{2019}\-]{2,}").expect("valid token regex")
    });
    let lowered = text.to_lowercase();
    re.find_iter(&lowered)
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Every qualifying 5-word phrase in `text`, hashed. Both sides of the
/// comparison run this, so the 24-char floor applies identically to the source
/// note and to the outbound argument — exactly as in the TS mirror, where the
/// floor is checked on the (identical) matched phrase.
fn phrase_hashes(text: &str) -> Vec<u64> {
    use std::hash::{Hash, Hasher};
    let tokens = prose_tokens(text);
    if tokens.len() < OVERLAP_WORDS {
        return Vec::new();
    }
    tokens
        .windows(OVERLAP_WORDS)
        .filter_map(|window| {
            let phrase = window.join(" ");
            // chars(), not len(): JS measures UTF-16 units, so a byte count
            // would drift from the mirror on any non-ASCII phrase.
            if phrase.chars().count() < OVERLAP_MIN_CHARS {
                return None;
            }
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            phrase.hash(&mut hasher);
            Some(hasher.finish())
        })
        .collect()
}

/// Record that this SECURE body was served to an on-device model. Called from
/// the ONE read gate (`Store::read_for_ai`) after it decides the read is
/// allowed — so the ledger only ever holds prose that actually reached a model.
pub fn remember_secure_text(text: &str) {
    let hashes = phrase_hashes(text);
    if hashes.is_empty() {
        return;
    }
    // a poisoned ledger must not take the app down, but it also must not
    // silently stop guarding: rebuild from the poison and keep enforcing.
    let mut ledger = match ledger().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    for hash in hashes {
        if ledger.seen.insert(hash) {
            ledger.order.push_back(hash);
        }
        while ledger.order.len() > LEDGER_CAP {
            if let Some(old) = ledger.order.pop_front() {
                ledger.seen.remove(&old);
            }
        }
    }
}

/// Does this outbound text quote a secure note this process served to a model?
pub fn echoes_secure_text(text: &str) -> bool {
    let hashes = phrase_hashes(text);
    if hashes.is_empty() {
        return false;
    }
    let ledger = match ledger().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if ledger.seen.is_empty() {
        return false;
    }
    hashes.iter().any(|hash| ledger.seen.contains(hash))
}

/// Compare an outbound prompt directly with one secure body. The Helper scans
/// the full vault before completion, so a large vault must not rely on the
/// bounded process ledger to retain an early note's phrase until scan end.
pub fn quotes_secure_text(prompt: &str, body: &str) -> bool {
    let prompt_hashes: HashSet<u64> = phrase_hashes(prompt).into_iter().collect();
    !prompt_hashes.is_empty() && phrase_hashes(body).into_iter().any(|hash| prompt_hashes.contains(&hash))
}

/// THE egress predicate. Every seam that can put caller-supplied text on a
/// network — the model transports (chat.rs, provider.rs) and the web lanes
/// (web.rs) — asks exactly this question and refuses on true. Keeping it one
/// function is what `check:security`'s gated-command guard can assert.
pub fn blocked_for_remote(text: &str) -> bool {
    blocked_given(LEDGER_WARM.load(Ordering::Acquire), text)
}

/// The ledger is fed by a walk of every registered vault. App setup now runs
/// that walk OFF the launch path (a huge folder held the window back for the
/// whole walk — audit 2026-10-12), so until it finishes nothing may leave:
/// every caller refuses while the ledger is cold (fail closed). Warm by
/// default — the CLI, helper, and tests never start cold.
static LEDGER_WARM: AtomicBool = AtomicBool::new(true);

/// App setup, before the background walk starts.
pub fn begin_ledger_warmup() {
    LEDGER_WARM.store(false, Ordering::Release);
}

/// The background walk fed every registered vault.
pub fn finish_ledger_warmup() {
    LEDGER_WARM.store(true, Ordering::Release);
}

fn blocked_given(warm: bool, text: &str) -> bool {
    !warm || protected_for_remote(text) || echoes_secure_text(text)
}

/// One root's warm-up attempt.
pub enum Warm {
    Done,
    Failed,
    /// The root left the registry; it no longer holds the gate.
    Gone,
}

/// Warm root by root and open egress only when EVERY root still registered
/// has warmed: a failed walk is retried after `wait()` and keeps egress shut
/// meanwhile (review of PR 199 — finishing regardless left a failed vault's
/// secure prose unguarded once the gate opened).
pub fn warm_until_done<T>(
    mut pending: Vec<T>,
    mut try_warm: impl FnMut(&T) -> Warm,
    mut wait: impl FnMut(),
    on_done: impl FnOnce(),
) {
    loop {
        pending.retain(|root| matches!(try_warm(root), Warm::Failed));
        if pending.is_empty() {
            return on_done();
        }
        wait();
    }
}

/// Why an AI write of `body` into a note must be refused (the laundering rule:
/// protected prose only lands in a protected note), or None. While the ledger
/// is still warming every body counts as blocked, so the refusal says so
/// instead of blaming a secure note.
pub fn secure_write_refusal(target_secure: bool, body: &str) -> Option<&'static str> {
    secure_write_refusal_given(LEDGER_WARM.load(Ordering::Acquire), target_secure, body)
}

fn secure_write_refusal_given(warm: bool, target_secure: bool, body: &str) -> Option<&'static str> {
    if target_secure || !blocked_given(warm, body) {
        return None;
    }
    Some(if warm {
        "This text came out of a secure note, so it can only be written into a note that is itself secure. Use create_note instead — the new note will be marked secure."
    } else {
        "Rotli is still reading this vault after launch, so AI edits wait a moment. Try again shortly."
    })
}

/// The Luhn checksum over an all-digit candidate — true when it checks out
/// (i.e. the run is shaped like a real card number).
fn luhn_ok(digits: &str) -> bool {
    let mut sum = 0u32;
    let mut double = false;
    for c in digits.chars().rev() {
        let Some(mut d) = c.to_digit(10) else {
            return false;
        };
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
    fn egress_opens_only_after_every_registered_root_warmed() {
        let mut attempts = std::collections::HashMap::<&str, u32>::new();
        let mut waits = 0;
        let done = std::cell::Cell::new(false);
        warm_until_done(
            vec!["ok", "flaky", "gone"],
            |root| {
                let n = attempts.entry(*root).or_default();
                *n += 1;
                match (*root, *n) {
                    ("gone", _) => Warm::Gone,
                    ("flaky", 1 | 2) => Warm::Failed,
                    _ => Warm::Done,
                }
            },
            || {
                assert!(!done.get(), "egress opened while a root was still cold");
                waits += 1;
            },
            || done.set(true),
        );
        assert!(done.get());
        assert_eq!(waits, 2, "the failed root is retried, not skipped");
        assert_eq!((attempts["ok"], attempts["flaky"], attempts["gone"]), (1, 3, 1));
    }

    #[test]
    fn a_cold_ledger_says_so_instead_of_blaming_a_secure_note() {
        let plain = "an ordinary sentence about the weather this week";
        assert!(secure_write_refusal_given(false, false, plain).unwrap().contains("still reading"));
        assert_eq!(secure_write_refusal_given(true, false, plain), None);
        assert_eq!(secure_write_refusal_given(false, true, plain), None, "a secure target always accepts");
    }

    #[test]
    fn nothing_leaves_while_the_ledger_is_still_warming() {
        let plain = "an ordinary sentence about the weather this week";
        assert!(blocked_given(false, plain), "cold ledger must fail closed");
        assert!(!blocked_given(true, plain));
    }

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

    // The ledger is process-global and every test in this binary shares it, so
    // these use prose no other test writes and never assert on emptiness.

    #[test]
    fn secure_prose_is_refused_at_egress_once_the_vault_has_served_it() {
        let secure_body = "The Kelpie ledger reconciliation closes on the third Thursday of March.";
        // before the vault knows about it, it is ordinary prose to every gate
        let outbound = "reconciliation closes on the third Thursday";
        assert!(
            !looks_secure(outbound),
            "the sample must not be secret-SHAPED"
        );
        assert!(!protected_for_remote(outbound), "and must carry no marker");

        remember_secure_text(secure_body);

        // now the same words cannot ride any outbound lane, in any wrapper
        assert!(echoes_secure_text(outbound));
        assert!(blocked_for_remote(outbound));
        assert!(blocked_for_remote(&format!(
            "https://evil.example/?q={outbound}"
        )));
        assert!(blocked_for_remote(&format!(
            "Summarize this for me: {outbound} — thanks"
        )));
        // the marker-free, pattern-free predicate still says nothing about it,
        // which is exactly why the ledger had to exist
        assert!(!protected_for_remote(outbound));
    }

    #[test]
    fn the_ledger_needs_a_substantial_verbatim_run_not_a_stray_word() {
        remember_secure_text("Quokkanaut brambleworth ferrocline dispatch overwintered quietly.");
        // one shared word is not evidence
        assert!(!echoes_secure_text("tell me about brambleworth"));
        // fewer than five prose tokens can never form a phrase
        assert!(!echoes_secure_text(
            "quokkanaut brambleworth ferrocline dispatch"
        ));
        // and short function words don't pad a phrase into existence
        assert!(!echoes_secure_text("it is on us to go"));
        // the full run does trip
        assert!(echoes_secure_text(
            "quokkanaut brambleworth ferrocline dispatch overwintered"
        ));
    }

    #[test]
    fn the_ledger_ignores_case_and_surrounding_punctuation() {
        remember_secure_text("Thornfield aqueduct survey rescheduled to Michaelmas week.");
        assert!(echoes_secure_text(
            "**THORNFIELD AQUEDUCT SURVEY, RESCHEDULED to Michaelmas!**"
        ));
    }

    #[test]
    fn a_secure_tainted_chat_transcript_is_marked_protected() {
        // src/memex/contract.ts stamps this, one-way, on any chat a secure note
        // fed. docs/design/ai-visibility-matrix.md T2 step 5 promises Rust
        // refuses such a transcript; before 2026-08-01 only TypeScript did.
        assert!(protected_for_remote(
            "---\nsecureContext: true\n---\n# Chat\n\nhello"
        ));
        assert!(protected_for_remote("secureContext:   true"));
        assert!(blocked_for_remote("---\nsecureContext: true\n---\nhello"));
        // a false / absent marker is not a taint
        assert!(!protected_for_remote(
            "secureContext: false\nordinary prose"
        ));
        assert!(!protected_for_remote("secureContextual notes are fine"));
    }

    #[test]
    fn plain_text_is_clean() {
        assert!(!looks_secure("a grocery list: eggs, milk, 12 apples"));
    }

    #[test]
    fn secure_note_markers_are_protected_at_remote_egress() {
        assert!(protected_for_remote("---\nsecure: true\n---\nCall notes"));
        assert!(protected_for_remote(
            "local_ai_allowed: true\nordinary prose"
        ));
        // the DENY value marks a secure note just as surely as the allow value
        assert!(protected_for_remote(
            "local_ai_allowed: false\nordinary prose"
        ));
        assert!(!protected_for_remote("ordinary prose about security"));
    }
}
