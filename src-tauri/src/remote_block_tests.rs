use super::*;

const CARD: &str = "4242 4242 4242 4242";

#[test]
fn a_cold_ledger_waits_before_anything_else() {
    assert_eq!(remote_block_given(false, "hello there", &[]), Some(RemoteBlock::Warming));
    assert_eq!(remote_block_given(true, "hello there", &[]), None);
}

#[test]
fn a_typed_pattern_is_held_back_until_the_person_sends_it_anyway() {
    let message = format!("my test card is {CARD}, does checkout accept it?");
    let prompt = format!("Conversation:\nyou: {message}");
    assert_eq!(remote_block_given(true, &prompt, &[]), Some(RemoteBlock::Pattern));
    assert_eq!(remote_block_given(true, &prompt, std::slice::from_ref(&message)), None);
}

#[test]
fn consent_covers_only_what_the_person_typed() {
    // the same card also arrives from an attached note: consent for the typed
    // message excuses its own span, but every match must be covered
    let message = "is this card fine?".to_string();
    let prompt = format!("you: {message}\nAttached note:\n{CARD}");
    assert_eq!(remote_block_given(true, &prompt, &[message]), Some(RemoteBlock::Pattern));
}

#[test]
fn secure_note_text_is_never_overridable() {
    let note = "---\nsecure: true\n---\nthe launch plan";
    let consent = vec![note.to_string()];
    assert_eq!(remote_block_given(true, note, &consent), Some(RemoteBlock::SecureText));
    let tainted = "secureContext: true\nyou: hello";
    assert_eq!(remote_block_given(true, tainted, &[tainted.to_string()]), Some(RemoteBlock::SecureText));
}

#[test]
fn secure_prose_an_on_device_model_read_stays_blocked_with_consent() {
    let prose = "the Halverson acquisition closes quietly in the third quarter of next year";
    crate::secret::remember_secure_text(prose);
    let consent = vec![prose.to_string()];
    assert_eq!(remote_block_given(true, prose, &consent), Some(RemoteBlock::SecureText));
}

#[test]
fn the_error_carries_a_tag_the_chat_reads() {
    assert!(RemoteBlock::Pattern.message().starts_with("rotli-blocked:pattern "));
    assert!(RemoteBlock::SecureText.message().starts_with("rotli-blocked:secure "));
    assert!(RemoteBlock::Warming.message().starts_with("rotli-blocked:warming "));
    assert_eq!(first_block(&["fine", CARD], &[]), Some(RemoteBlock::Pattern));
    assert_eq!(first_block(&["fine", "also fine"], &[]), None);
}
