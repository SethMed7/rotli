//! Drags that carry no path. Finder puts `NSFilenamesPboardType` on the drag
//! pasteboard and wry reads it, so a Finder drop reaches `native_drag` with
//! real paths. Two common macOS drags carry no path at all:
//!
//! - the **screenshot thumbnail** (the floating preview after ⌘⇧4 / ⌘⇧5) hands
//!   over an `NSFilePromiseReceiver` — a promise that a file will be written
//!   into a destination directory *we* name, asynchronously;
//! - a **browser or Photos image** drag hands over raw bytes (`public.png`,
//!   `public.tiff`) with no file behind them.
//!
//! wry reads neither, so Tauri reports `Drop { paths: [] }` and the gesture
//! used to die as "Nothing imported". This module reads the drag pasteboard
//! itself and materialises a real file under `$TMPDIR/rotli-drops/<uuid>/`,
//! then hands it to the ONE delivery point every lane shares,
//! `native_drag::deliver` — so a promise drop gets the same one-shot import
//! grant, the same event, and the same webview routing a Finder drop gets.
//!
//! Order, and why. A drop with Finder paths never reaches here: the path is
//! the truth and the pasteboard is ignored. With no paths we take promises
//! first (the promised file is the real artifact, at full fidelity and with
//! the sender's own name), then the byte lane (the same drag often carries a
//! preview rendition as well), then give up and let `native_drag` refuse.
//!
//! Staging files live in the temp directory, not the vault: the import copies
//! what it needs into the vault, and `sweep_stale` drops anything older than a
//! day on the next drop so the directory cannot grow forever.
//!
//! Set `ROTLI_DEBUG_DROPS=1` to print the pasteboard's type list and the lane
//! this module chose for every drop.

use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, SystemTime};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyClass;
use objc2::ClassType;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSFilePromiseReceiver, NSPasteboard,
    NSPasteboardNameDrag, NSPasteboardTypePNG, NSPasteboardTypeTIFF,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSOperationQueue, NSURL};
use tauri::Window;
use time::OffsetDateTime;

use crate::native_drag::{self, DropPosition};

/// Staging directory for files a pathless drop materialised, under `$TMPDIR`.
const DROPS_DIR: &str = "rotli-drops";
/// How long a staging directory may sit before the next drop sweeps it away.
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
/// Raw image bytes the byte lane can turn into a PNG, in preference order.
const PNG_TYPE: &str = "public.png";
const TIFF_TYPE: &str = "public.tiff";

/// What a pathless drag can still be served from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DropLane {
    /// The drag promises files (the screenshot thumbnail).
    Promise,
    /// The drag carries image bytes only (a browser or Photos drag).
    ImageBytes,
    /// Nothing this module can turn into a file.
    Nothing,
}

// ─── pure helpers (no AppKit — these are what the tests drive) ────────────────

/// Which lane the drag pasteboard's type list buys us. `promise_types` is
/// AppKit's own `NSFilePromiseReceiver.readableDraggedTypes`, passed in rather
/// than hardcoded so a future `com.apple.*` promise UTI needs no edit here.
pub(crate) fn lane_for(types: &[String], promise_types: &[String]) -> DropLane {
    if types.iter().any(|offered| promise_types.iter().any(|promise| promise == offered)) {
        return DropLane::Promise;
    }
    if types.iter().any(|offered| offered == PNG_TYPE || offered == TIFF_TYPE) {
        return DropLane::ImageBytes;
    }
    DropLane::Nothing
}

/// The staging root shared by every pathless drop.
pub(crate) fn drops_root() -> PathBuf {
    std::env::temp_dir().join(DROPS_DIR)
}

/// A fresh, empty directory for one drop. Every drop gets its own so two
/// screenshots taken in the same second cannot collide, and so a promise that
/// never arrives leaves nothing behind but an empty folder.
pub(crate) fn fresh_drop_dir(root: &Path) -> std::io::Result<PathBuf> {
    let dir = root.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Delete staging directories older than `max_age`. One `read_dir` on a
/// directory that normally holds a handful of entries — cheap enough to run on
/// every drop, which is the only moment we are sure the app is alive to do it.
pub(crate) fn sweep_stale(root: &Path, now: SystemTime, max_age: Duration) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let stale = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > max_age);
        if !stale {
            continue;
        }
        if metadata.is_dir() {
            let _ = fs::remove_dir_all(entry.path());
        } else {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// The name a byte-lane image is written under. The editor decides an inline
/// image by EXTENSION (`isImagePath` in src/editor/externalImageDrop.ts), and
/// the person sees this name in the vault, so it reads like a Finder file and
/// ends in `.png`. Colons are illegal in a file name, hence `HH.mm.ss`.
pub(crate) fn dropped_image_name(now: OffsetDateTime) -> String {
    format!(
        "Dropped image {:04}-{:02}-{:02} {:02}.{:02}.{:02}.png",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

// ─── AppKit: reading the drag pasteboard ─────────────────────────────────────

/// The pasteboard the live drag session is using.
fn drag_pasteboard() -> Retained<NSPasteboard> {
    // SAFETY: an AppKit-provided immutable NSString constant.
    let name = unsafe { NSPasteboardNameDrag };
    NSPasteboard::pasteboardWithName(name)
}

fn type_names(pasteboard: &NSPasteboard) -> Vec<String> {
    pasteboard
        .types()
        .map(|types| types.to_vec().iter().map(|name| name.to_string()).collect())
        .unwrap_or_default()
}

fn promise_type_names() -> Vec<String> {
    NSFilePromiseReceiver::readableDraggedTypes()
        .to_vec()
        .iter()
        .map(|name| name.to_string())
        .collect()
}

/// The promise receivers on the drag pasteboard. Apple's contract: a receiver
/// must be OBTAINED while the drop is being handled; the files it promises may
/// land long afterwards.
fn promise_receivers(pasteboard: &NSPasteboard) -> Vec<Retained<NSFilePromiseReceiver>> {
    let classes = NSArray::from_slice(&[NSFilePromiseReceiver::class() as &AnyClass]);
    // SAFETY: the class array holds exactly one NSPasteboardReading class and
    // no reading options are passed.
    let read = unsafe { pasteboard.readObjectsForClasses_options(&classes, None) };
    read.map(|objects| {
        objects
            .to_vec()
            .into_iter()
            .filter_map(|object| object.downcast::<NSFilePromiseReceiver>().ok())
            .collect()
    })
    .unwrap_or_default()
}

/// The drag's image bytes as PNG. `public.png` rides through untouched;
/// `public.tiff` (what AppKit and most native senders offer) is re-encoded,
/// because the editor embeds by extension and Rotli's viewers speak PNG.
fn pasteboard_png(pasteboard: &NSPasteboard) -> Option<Vec<u8>> {
    // SAFETY: AppKit-provided immutable NSString constants.
    let (png_type, tiff_type) = unsafe { (NSPasteboardTypePNG, NSPasteboardTypeTIFF) };
    if let Some(data) = pasteboard.dataForType(png_type) {
        return Some(data.to_vec());
    }
    let tiff = pasteboard.dataForType(tiff_type)?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
    // SAFETY: an empty properties dictionary is valid for every storage type.
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(png.to_vec())
}

// ─── the two lanes ───────────────────────────────────────────────────────────

/// One drop's promised files as they arrive. The reader block runs on the MAIN
/// queue, so every touch of this is on the same thread and `Rc<RefCell<_>>` is
/// the honest type.
struct PromiseTally {
    /// Reader calls still expected; delivery happens when this reaches zero.
    pending: usize,
    /// How many files the drop offered (the refused event reports this).
    offered: usize,
    /// Files that actually landed.
    arrived: Vec<PathBuf>,
    /// Set once so a late extra reader call cannot deliver a second time.
    delivered: bool,
}

/// Call in every promise and deliver when the last one reports. Returns true:
/// the drop is ours now, even though the files are still on their way.
fn start_receiving(
    window: &Window,
    position: DropPosition,
    receivers: &[Retained<NSFilePromiseReceiver>],
    destination: &Path,
) -> bool {
    // `fileTypes` is one UTI per promised file and is readable BEFORE the
    // receive (`fileNames` is empty until then — AppKit's own header says so).
    // A legacy sender may list a type once and write several files of it, so
    // this is a floor: an extra reader call after delivery is ignored.
    let offered: usize = receivers.iter().map(|receiver| receiver.fileTypes().len().max(1)).sum();
    let Some(destination) = NSURL::from_file_path(destination) else {
        return false;
    };
    let tally = Rc::new(RefCell::new(PromiseTally {
        pending: offered,
        offered,
        arrived: Vec::new(),
        delivered: false,
    }));
    // The main queue, deliberately. The promised bytes are written by the
    // SENDER's process (screencaptureui for a screenshot), so the reader block
    // is a notification, not work: running it on the main run loop — after
    // performDragOperation has returned — keeps the receiver, the window, and
    // the tally on one thread with no cross-thread lifetime to reason about.
    let queue = NSOperationQueue::mainQueue();
    let options = NSDictionary::new();
    for receiver in receivers {
        let tally = Rc::clone(&tally);
        let window = window.clone();
        // Pin the receiver for as long as AppKit holds the block. AppKit
        // retains it internally too, but a promise outliving this function is
        // exactly the lifetime Apple warns about, so do not rely on that.
        let pinned = receiver.clone();
        let reader = RcBlock::new(move |url: std::ptr::NonNull<NSURL>, error: *mut NSError| {
            let _ = &pinned;
            // A cancelled or failed write still calls the reader, with an
            // error and a URL to ignore.
            let arrived = if error.is_null() {
                // SAFETY: AppKit hands a live NSURL for the call's duration.
                unsafe { url.as_ref() }.to_file_path()
            } else {
                None
            };
            finish_one(&window, &tally, arrived, position);
        });
        // SAFETY: the options dictionary is documented as ignored, and the
        // main operation queue outlives the app.
        unsafe {
            receiver.receivePromisedFilesAtDestination_options_operationQueue_reader(
                &destination,
                &options,
                &queue,
                &reader,
            );
        }
    }
    true
}

/// One promised file reported in. Deliver once the last one has.
fn finish_one(
    window: &Window,
    tally: &Rc<RefCell<PromiseTally>>,
    arrived: Option<PathBuf>,
    position: DropPosition,
) {
    let ready = {
        let Ok(mut tally) = tally.try_borrow_mut() else {
            return;
        };
        if tally.delivered {
            return;
        }
        if let Some(path) = arrived {
            tally.arrived.push(path);
        }
        tally.pending = tally.pending.saturating_sub(1);
        if tally.pending > 0 {
            return;
        }
        tally.delivered = true;
        (std::mem::take(&mut tally.arrived), tally.offered)
    };
    let (paths, offered) = ready;
    if native_drag::debug_drops() {
        eprintln!("rotli: drop promise complete — {} of {offered} file(s) arrived", paths.len());
    }
    native_drag::deliver(window, offered, &paths, position);
}

/// Write the drag's image bytes into `destination` as a PNG.
fn write_image_bytes(pasteboard: &NSPasteboard, destination: &Path) -> Option<PathBuf> {
    let png = pasteboard_png(pasteboard)?;
    let path = destination.join(dropped_image_name(OffsetDateTime::now_utc()));
    fs::write(&path, png).ok()?;
    Some(path)
}

// ─── entry points ────────────────────────────────────────────────────────────

/// Whether a hovering drag with no Finder paths still carries something this
/// module can serve — the page needs a non-zero count to draw its drop line.
pub(crate) fn drag_offers_content() -> bool {
    lane_for(&type_names(&drag_pasteboard()), &promise_type_names()) != DropLane::Nothing
}

/// Take a pathless drop off the drag pasteboard. Returns false when there is
/// nothing to take, which is the caller's cue to refuse the drop as before.
/// True means this module owns the drop — delivering now (bytes) or when the
/// promised files land (promise).
pub(crate) fn claim(window: &Window, position: DropPosition) -> bool {
    let pasteboard = drag_pasteboard();
    let types = type_names(&pasteboard);
    let promise_types = promise_type_names();
    let lane = lane_for(&types, &promise_types);
    let debug = native_drag::debug_drops();
    if debug {
        // Both lists: which promise UTI matched says whether the sender is a
        // modern NSFilePromiseProvider or a legacy promiser, and that decides
        // how AppKit waits for the file.
        eprintln!("rotli: drop pasteboard types {types:?} → {lane:?}");
        eprintln!("rotli: drop promise types readable here {promise_types:?}");
    }
    if lane == DropLane::Nothing {
        return false;
    }

    let root = drops_root();
    sweep_stale(&root, SystemTime::now(), STALE_AFTER);
    let destination = match fresh_drop_dir(&root) {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("rotli: native drop could not stage under {}: {error}", root.display());
            return false;
        }
    };

    let receivers = promise_receivers(&pasteboard);
    if !receivers.is_empty() {
        if debug {
            eprintln!(
                "rotli: drop calling in {} file promise(s) → {}",
                receivers.len(),
                destination.display()
            );
        }
        if start_receiving(window, position, &receivers, &destination) {
            return true;
        }
    }
    match write_image_bytes(&pasteboard, &destination) {
        Some(path) => {
            if debug {
                eprintln!("rotli: drop wrote pasteboard image bytes → {}", path.display());
            }
            native_drag::deliver(window, 1, std::slice::from_ref(&path), position);
            true
        }
        None => {
            let _ = fs::remove_dir(&destination);
            if debug {
                eprintln!("rotli: drop had {lane:?} types but yielded no file");
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn a_promise_type_beats_image_bytes_on_the_same_drag() {
        // the screenshot thumbnail offers both; the promised file is the real one
        let promises = owned(&["com.apple.pasteboard.promised-file-content-type"]);
        let types = owned(&[
            "com.apple.pasteboard.promised-file-content-type",
            PNG_TYPE,
            "public.utf8-plain-text",
        ]);
        assert_eq!(lane_for(&types, &promises), DropLane::Promise);
    }

    #[test]
    fn image_bytes_serve_a_drag_with_no_promise() {
        let promises = owned(&["com.apple.pasteboard.promised-file-content-type"]);
        assert_eq!(lane_for(&owned(&[PNG_TYPE]), &promises), DropLane::ImageBytes);
        assert_eq!(lane_for(&owned(&[TIFF_TYPE]), &promises), DropLane::ImageBytes);
    }

    #[test]
    fn a_text_or_empty_drag_is_nothing_to_take() {
        let promises = owned(&["com.apple.pasteboard.promised-file-content-type"]);
        assert_eq!(lane_for(&owned(&["public.utf8-plain-text"]), &promises), DropLane::Nothing);
        assert_eq!(lane_for(&[], &promises), DropLane::Nothing);
        // no promise types known (an OS that reports none) must not claim one
        assert_eq!(lane_for(&owned(&["com.apple.pasteboard.promised-file-url"]), &[]), DropLane::Nothing);
    }

    #[test]
    fn every_drop_stages_in_its_own_fresh_directory() {
        let root = tempfile::tempdir().unwrap();
        let first = fresh_drop_dir(root.path()).unwrap();
        let second = fresh_drop_dir(root.path()).unwrap();
        assert_ne!(first, second);
        assert!(first.is_dir() && second.is_dir());
        assert_eq!(first.parent(), Some(root.path()));
    }

    #[test]
    fn the_sweep_drops_yesterdays_staging_and_keeps_todays() {
        let root = tempfile::tempdir().unwrap();
        let staged = fresh_drop_dir(root.path()).unwrap();
        fs::write(staged.join("shot.png"), b"png").unwrap();
        let loose = root.path().join("stray.png");
        fs::write(&loose, b"png").unwrap();

        sweep_stale(root.path(), SystemTime::now(), STALE_AFTER);
        assert!(staged.is_dir(), "a drop staged now must survive");
        assert!(loose.is_file());

        let tomorrow = SystemTime::now() + Duration::from_secs(48 * 60 * 60);
        sweep_stale(root.path(), tomorrow, STALE_AFTER);
        assert!(!staged.exists(), "a day-old staging directory is swept");
        assert!(!loose.exists(), "a stray file is swept too");
    }

    #[test]
    fn the_sweep_is_silent_when_nothing_was_ever_staged() {
        let root = tempfile::tempdir().unwrap();
        sweep_stale(&root.path().join("never-created"), SystemTime::now(), STALE_AFTER);
    }

    #[test]
    fn a_dropped_image_is_named_like_a_finder_file() {
        let at = OffsetDateTime::from_unix_timestamp(1_757_000_045).unwrap();
        let name = dropped_image_name(at);
        assert_eq!(name, "Dropped image 2025-09-04 15.34.05.png");
        // the editor embeds by extension, so the suffix is load-bearing
        assert!(name.ends_with(".png"));
        assert!(!name.contains(':'));
    }
}
