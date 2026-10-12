//! The usage scan's JSONL reader: one transcript segment, line by line.
//!
//! One line buffer is reused across every file of a scan. A fresh buffer per
//! file doubled toward the longest line (up to 8 MB) a thousand times over, and
//! the freed large blocks stayed in the process footprint: ~195 MB after one
//! 90-day scan of a 10 GB history, 37 MB in total with reuse (RAM review
//! 2026-10-12). `release_line_buffer` shrinks it back after each scan.

use std::cell::RefCell;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// A longer line is skipped (counted by `on_oversized`), never buffered.
pub(crate) const MAX_JSONL_LINE_BYTES: usize = 8 * 1024 * 1024;

thread_local! {
    static LINE_BUFFER: RefCell<Vec<u8>> = RefCell::new(Vec::with_capacity(8 * 1024));
}

/// Hand each complete line of `path[offset..offset + byte_count]` (without its
/// line ending) to `on_line`; a final line with no newline is handed over too.
/// Returns whether the segment ended on a newline.
pub(crate) fn read_jsonl_segment(
    path: &Path,
    offset: u64,
    byte_count: u64,
    mut on_line: impl FnMut(&[u8]),
    mut on_oversized: impl FnMut(),
) -> Result<bool, ()> {
    let mut file = File::open(path).map_err(|_| ())?;
    file.seek(SeekFrom::Start(offset)).map_err(|_| ())?;
    let mut reader = BufReader::new(file.take(byte_count));
    let mut line = LINE_BUFFER.with(|cell| std::mem::take(&mut *cell.borrow_mut()));
    line.clear();
    let result = read_lines(&mut reader, &mut line, &mut on_line, &mut on_oversized);
    LINE_BUFFER.with(|cell| *cell.borrow_mut() = line);
    result
}

/// Drop the buffer's capacity past 64 KB once a scan is done.
pub(crate) fn release_line_buffer() {
    LINE_BUFFER.with(|cell| cell.borrow_mut().shrink_to(64 * 1024));
}

fn read_lines(
    reader: &mut impl BufRead,
    line: &mut Vec<u8>,
    on_line: &mut impl FnMut(&[u8]),
    on_oversized: &mut impl FnMut(),
) -> Result<bool, ()> {
    let mut oversized = false;
    let mut ended_with_newline = true;
    loop {
        let buffer = reader.fill_buf().map_err(|_| ())?;
        if buffer.is_empty() {
            if !line.is_empty() && !oversized {
                on_line(line);
            }
            return Ok(ended_with_newline);
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(buffer.len(), |index| index + 1);
        ended_with_newline = newline.is_some();
        if !oversized {
            if line.len().saturating_add(take) <= MAX_JSONL_LINE_BYTES {
                line.extend_from_slice(&buffer[..take]);
            } else {
                oversized = true;
                line.clear();
                on_oversized();
            }
        }
        reader.consume(take);
        if newline.is_some() {
            if !oversized {
                while line.last().is_some_and(|byte| *byte == b'\n' || *byte == b'\r') {
                    line.pop();
                }
                on_line(line);
            }
            line.clear();
            oversized = false;
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn lines_split_across_files_share_one_buffer() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("a.jsonl");
        std::fs::write(&path, "one\r\ntwo\nlast").unwrap();
        let mut seen = Vec::new();
        let ended = super::read_jsonl_segment(&path, 0, 13, |l| seen.push(l.to_vec()), || {}).unwrap();
        assert_eq!(seen, [b"one".to_vec(), b"two".to_vec(), b"last".to_vec()]);
        assert!(!ended);
        let mut tail = Vec::new();
        assert!(super::read_jsonl_segment(&path, 5, 4, |l| tail.push(l.to_vec()), || {}).unwrap());
        assert_eq!(tail, [b"two".to_vec()]);
    }
}
