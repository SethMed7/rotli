//! The one way Rotli streams to the webview. Every message stays under `LIMIT`
//! bytes as Tauri serializes it, so it is delivered directly to the webview
//! that made the call. `check:ipc` keeps every other file off Tauri's channel
//! type, so nothing can send around this.

use tauri::ipc::{Channel, CommandArg, CommandItem, InvokeError, InvokeResponseBody};
use tauri::Runtime;

/// Room to spare under the 8,192 bytes Tauri delivers directly.
pub const LIMIT: usize = 6 * 1024;

/// A command's streaming argument (a `Channel<string>` in the webview).
pub struct EventChannel(Channel);

impl<'de, R: Runtime> CommandArg<'de, R> for EventChannel {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        Channel::from_command(command).map(Self)
    }
}

/// `text` as the webview receives it: one JSON string.
fn body(text: &str) -> String {
    serde_json::Value::from(text).to_string()
}

impl EventChannel {
    /// Sends `text` as one message, or refuses it when it is too large to stay small.
    pub fn send(&self, text: &str) -> Result<(), String> {
        let body = body(text);
        if body.len() >= LIMIT {
            return Err(format!("a {}-byte event is too large to stream", body.len()));
        }
        self.0.send(InvokeResponseBody::Json(body)).map_err(|e| e.to_string())
    }

    /// Sends text the webview appends as it arrives (a token stream), in as many
    /// messages as keep each one small.
    pub fn send_text(&self, text: &str) -> Result<(), String> {
        for piece in pieces(text) {
            self.send(piece)?;
        }
        Ok(())
    }

    /// A channel whose messages go to `on_body` exactly as the webview would get them.
    #[cfg(test)]
    pub fn from_fn(on_body: impl Fn(String) + Send + Sync + 'static) -> Self {
        Self(Channel::new(move |sent| {
            if let InvokeResponseBody::Json(raw) = sent {
                on_body(raw);
            }
            Ok(())
        }))
    }
}

/// `text` cut on character boundaries into pieces that each serialize under `LIMIT`.
fn pieces(text: &str) -> Vec<&str> {
    if body(text).len() < LIMIT {
        return vec![text];
    }
    let room = LIMIT - 2; // the two quotes
    let mut out = Vec::new();
    let (mut start, mut size) = (0, 0);
    for (at, ch) in text.char_indices() {
        let width = body(ch.encode_utf8(&mut [0; 4])).len() - 2;
        if size + width >= room {
            out.push(&text[start..at]);
            (start, size) = (at, 0);
        }
        size += width;
    }
    out.push(&text[start..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn recorded() -> (EventChannel, Arc<Mutex<Vec<String>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&sent);
        (EventChannel::from_fn(move |raw| log.lock().unwrap().push(raw)), sent)
    }

    #[test]
    fn a_message_is_sent_as_the_webviews_json_string() {
        let (channel, sent) = recorded();
        channel.send("{\"type\":\"x\"}").unwrap();
        assert_eq!(*sent.lock().unwrap(), vec!["\"{\\\"type\\\":\\\"x\\\"}\"".to_string()]);
    }

    #[test]
    fn a_message_that_would_serialize_too_large_is_refused_unsent() {
        let (channel, sent) = recorded();
        // every quote doubles once escaped, so this is under LIMIT raw and over it sent
        assert!(channel.send(&"\"".repeat(LIMIT / 2)).is_err());
        assert!(channel.send(&"x".repeat(LIMIT)).is_err());
        assert!(sent.lock().unwrap().is_empty());
        channel.send(&"x".repeat(LIMIT - 3)).unwrap();
        assert_eq!(sent.lock().unwrap()[0].len(), LIMIT - 1);
    }

    #[test]
    fn long_text_arrives_whole_and_in_order_in_small_pieces() {
        let (channel, sent) = recorded();
        let text = format!("{}{}{}", "a".repeat(9000), "\"é\n😀".repeat(2000), "end");
        channel.send_text(&text).unwrap();
        let sent = sent.lock().unwrap();
        assert!(sent.len() > 2 && sent.iter().all(|raw| raw.len() < LIMIT));
        let joined: String = sent.iter().map(|raw| serde_json::from_str::<String>(raw).unwrap()).collect();
        assert_eq!(joined, text);
    }

    #[test]
    fn a_short_token_is_one_message() {
        let (channel, sent) = recorded();
        channel.send_text("hello").unwrap();
        assert_eq!(sent.lock().unwrap().len(), 1);
    }
}
