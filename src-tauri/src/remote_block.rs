//! Why a send to a connected (remote) model is refused, said precisely, and the
//! one refusal a person may overrule (the owner, 2026-10-15).
//!
//! `secret::blocked_for_remote` answers yes or no. A chat needs the reason:
//!   • `Warming`: Rotli just started and hasn't finished checking the vault's
//!     secure notes, so nothing may leave yet. The chat waits and retries.
//!   • `SecureText`: the text carries a secure-note marker or echoes prose a
//!     secure note gave an on-device model. Never overridable: secure notes
//!     never reach a remote model (AGENTS.md, product law).
//!   • `Pattern`: text shaped like a key, password, or card number. The person
//!     may choose "Send anyway", but only for text they typed or pasted
//!     themselves: each matching span must appear in one of their own messages
//!     (`consented`). A pattern that came from a note stays held back.
//!
//! The consent list comes from the webview, which the threat model treats as
//! untrusted. That is the accepted cost of the person's final say over their
//! own words: the secure-note half of the gate does not read it, so a
//! compromised webview can still never forward secure-note prose.
//!
//! Errors carry a stable tag (`rotli-blocked:<kind>`) that the chat turns into
//! its own wording (src/ai/remoteBlock.ts); the tag is not shown as is.

use crate::secret;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteBlock {
    Warming,
    SecureText,
    Pattern,
}

impl RemoteBlock {
    /// The error a remote lane returns: a tag the chat reads, then a plain
    /// sentence for any caller that shows the error as it is.
    pub(crate) fn message(self) -> String {
        let (tag, words) = match self {
            Self::Warming => (
                "warming",
                "Rotli is still checking your secure notes after starting, so nothing is sent to a connected model yet.",
            ),
            Self::SecureText => (
                "secure",
                "This conversation includes text from a secure note, so it can't be sent to a connected model.",
            ),
            Self::Pattern => (
                "pattern",
                "This message holds text shaped like a key, password, or card number, so it was held back from the connected model.",
            ),
        };
        format!("rotli-blocked:{tag} {words}")
    }
}

/// Why `text` may not go to a remote model, or `None` when it may. `consented`
/// holds the person's own messages they chose to send anyway (empty: no
/// consent given).
pub(crate) fn remote_block(text: &str, consented: &[String]) -> Option<RemoteBlock> {
    remote_block_given(secret::ledger_warm(), text, consented)
}

fn remote_block_given(warm: bool, text: &str, consented: &[String]) -> Option<RemoteBlock> {
    if !warm {
        return Some(RemoteBlock::Warming);
    }
    if secret::marked_protected(text) || secret::echoes_secure_text(text) {
        return Some(RemoteBlock::SecureText);
    }
    let typed = |span: &str| consented.iter().any(|message| message.contains(span));
    secret::secret_spans(text)
        .into_iter()
        .any(|range| !typed(&text[range]))
        .then_some(RemoteBlock::Pattern)
}

/// The first block across several outbound texts (a system prompt and a user
/// text are scanned separately, as each lane sends them).
pub(crate) fn first_block(texts: &[&str], consented: &[String]) -> Option<RemoteBlock> {
    texts.iter().find_map(|text| remote_block(text, consented))
}

#[cfg(test)]
#[path = "remote_block_tests.rs"]
mod tests;
