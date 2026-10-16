//! Bounded reads of one chat file for the chat listing. A transcript grows
//! without limit, so the listing never reads it whole: the frontmatter lives in
//! the HEAD window and the newest reply in the TAIL window.

use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use time::format_description::well_known::Rfc3339;
use time::{Date, Month, OffsetDateTime};

/// The first 41 lines of a file — exactly the window `fm()` can ever read
/// (opening `---` + its 40-line backstop). Chat listings need only
/// title/source/attachedTo/pinned, but transcripts grow unbounded, and
/// read_to_string dragged the whole body in per chat per listing (perf
/// audit 2026-07-30, finding 27). A 32 KiB byte cap backstops pathological
/// single-line files. One deliberate divergence from the old whole-file read:
/// a chat whose BODY is non-UTF-8 used to lose its frontmatter too
/// (read_to_string failed → ""); the head read now returns it, so such a chat
/// gains its real title/pinned instead of the "Untitled" fallback.
pub(crate) fn frontmatter_head(p: &Path) -> String {
    let Ok(f) = fs::File::open(p) else {
        return String::new();
    };
    let mut reader = BufReader::new(f).take(32 * 1024);
    let mut head = String::new();
    let mut line = String::new();
    for _ in 0..41 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => head.push_str(&line),
        }
    }
    head
}

/// How far back from the end the reply scan looks. A reply longer than this
/// has its message line outside the window; the listing then falls back to
/// the file's mtime, the order before 2026-10.
const TAIL_WINDOW: u64 = 64 * 1024;

/// When the chat's newest REPLY was written (ms since epoch; 0 when it has
/// none, or it sits outside the tail window). The sidebar orders chats by this
/// so a send — which writes the person's turn at once — leaves the chat in
/// place, and the arriving answer lifts it to the top (the owner, 2026-10-15).
pub(crate) fn last_reply_ms(p: &Path) -> u64 {
    let Ok(mut f) = fs::File::open(p) else {
        return 0;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(TAIL_WINDOW);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return 0;
    }
    let mut bytes = Vec::new();
    if f.read_to_end(&mut bytes).is_err() {
        return 0;
    }
    let tail = String::from_utf8_lossy(&bytes);
    // a window that starts mid-file starts mid-line: that fragment is not a
    // message line even when it happens to look like one
    let lines: Vec<&str> = tail.lines().skip(usize::from(start > 0)).collect();
    lines.into_iter().rev().find_map(reply_line_ms).unwrap_or(0)
}

/// `**<speaker>** · <at> — <text>` (contract.ts composeMessageLines) → the
/// `at` of a reply line in ms; None for the person's own turns and non-lines.
fn reply_line_ms(line: &str) -> Option<u64> {
    let rest = line.strip_prefix("**")?;
    let (speaker, rest) = rest.split_once("** · ")?;
    if speaker == "you" || speaker.is_empty() {
        return None;
    }
    let (at, _) = rest.split_once(" — ")?;
    stamp_ms(at.trim())
}

/// An RFC 3339 instant, or a bare `YYYY-MM-DD` (turns written before
/// per-message times) read as that day's UTC midnight.
fn stamp_ms(at: &str) -> Option<u64> {
    let instant = match OffsetDateTime::parse(at, &Rfc3339) {
        Ok(instant) => instant,
        Err(_) => {
            let mut parts = at.splitn(3, '-');
            let year: i32 = parts.next()?.parse().ok()?;
            let month = Month::try_from(parts.next()?.parse::<u8>().ok()?).ok()?;
            let day: u8 = parts.next()?.parse().ok()?;
            Date::from_calendar_date(year, month, day)
                .ok()?
                .midnight()
                .assume_utc()
        }
    };
    u64::try_from(instant.unix_timestamp_nanos() / 1_000_000).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat_with(body: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("c.md");
        fs::write(
            &p,
            format!("---\ntitle: T\n---\n\n# T\n\n## Messages\n\n{body}"),
        )
        .unwrap();
        (tmp, p)
    }

    #[test]
    fn the_newest_reply_is_the_last_non_you_line() {
        let (_tmp, p) = chat_with(
            "**you** · 2026-10-15T10:00:00.000Z — hi\n\
             **rotli** · 2026-10-15T10:00:05.000Z — hello\nsecond line\n\
             **you** · 2026-10-15T11:00:00.000Z — again\n",
        );
        // the pending send at 11:00 does not count; the 10:00:05 reply does
        assert_eq!(last_reply_ms(&p), 1_792_058_405_000);
    }

    #[test]
    fn no_reply_yet_and_unreadable_files_are_zero() {
        let (_tmp, p) = chat_with("**you** · 2026-10-15T10:00:00.000Z — hi\n");
        assert_eq!(last_reply_ms(&p), 0);
        assert_eq!(last_reply_ms(Path::new("/definitely/not/here.md")), 0);
    }

    #[test]
    fn a_date_only_turn_reads_as_that_days_midnight() {
        let (_tmp, p) = chat_with("**rotli** · 2026-10-15 — older format\n");
        assert_eq!(last_reply_ms(&p), 1_792_022_400_000);
    }

    #[test]
    fn a_reply_longer_than_the_window_falls_back_to_zero() {
        let long = "x".repeat(TAIL_WINDOW as usize + 10);
        let (_tmp, p) = chat_with(&format!("**rotli** · 2026-10-15T10:00:05.000Z — {long}\n"));
        assert_eq!(last_reply_ms(&p), 0);
    }

    #[test]
    fn the_head_window_holds_frontmatter_only() {
        let (_tmp, p) = chat_with(&"**you** · 2026-10-15 — line\n".repeat(100));
        assert_eq!(frontmatter_head(&p).lines().count(), 41);
    }
}
