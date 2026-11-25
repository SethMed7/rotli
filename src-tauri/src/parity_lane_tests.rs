// Parity for the paused connected lanes: the list, the picker label and the
// chat message are the same on both sides (src-tauri/src/lane_pause.rs,
// src/lib/lanePause.ts), so lifting a pause on one side alone fails a test.

use super::{entry, string_list};

#[test]
fn paused_chat_lanes() {
    let paused = entry("pausedChatLanes");
    assert_eq!(string_list(&paused["providers"]), crate::lane_pause::PAUSED_PROVIDERS);
    assert_eq!(paused["label"].as_str(), Some(crate::lane_pause::PAUSED_LABEL));
    assert_eq!(paused["message"].as_str(), Some(crate::lane_pause::PAUSED_MESSAGE));
}
