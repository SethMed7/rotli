//! A note's `created`/`updated` dates. The policy has one statement —
//! docs/architecture/memex-data-contract.md, "Metadata ownership" — and two
//! independent implementations: this one for the Mac app and `stampToMs` /
//! `today` in src/memex/dates.ts for Rotli Web. The `noteDateStamps` parity
//! fixture (scripts/fixtures/parity.json) pins both to the same answers.

use time::format_description::well_known::Rfc3339;
use time::{Date, Month, OffsetDateTime};

const HOUR_MS: i64 = 3_600_000;

/// A frontmatter `created`/`updated` stamp as epoch ms, or None when it is not
/// a date. A full RFC 3339 timestamp is taken as written. A date-only stamp
/// names a day, not an hour, so it never becomes an age in hours on its own:
/// the file's own time (`file_ms`) stands in when it falls on the stamped day —
/// the reader's local day, widened to the UTC day because Mac builds before
/// 2026-10 stamped the UTC day — so a note saved a minute ago reads "just
/// now"; otherwise (a copy or clone reset the file time) the stamp is local
/// midnight of that day. Same window as `stampToMs` in src/memex/dates.ts.
pub(crate) fn stamp_to_ms(stamp: &str, file_ms: Option<i64>) -> Option<i64> {
    stamp_to_ms_in(stamp, file_ms, local_offset_secs)
}

/// Today as the writer's own calendar day, `YYYY-MM-DD` — never a fixed zone's.
pub(crate) fn today_stamp() -> String {
    let now = OffsetDateTime::now_utc();
    day_stamp(now.unix_timestamp(), local_offset_secs)
}

/// `stamp_to_ms` with the local zone injected: `offset_at(utc_secs)` answers
/// the zone's UTC offset in seconds at that instant.
fn stamp_to_ms_in(
    stamp: &str,
    file_ms: Option<i64>,
    offset_at: impl Fn(i64) -> i64,
) -> Option<i64> {
    let value = stamp.trim();
    let date_shaped = value.len() == 10
        && value.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if !date_shaped {
        let t = OffsetDateTime::parse(value, &Rfc3339).ok()?;
        return Some((t.unix_timestamp_nanos() / 1_000_000) as i64);
    }
    let year: i32 = value[0..4].parse().ok()?;
    let month = Month::try_from(value[5..7].parse::<u8>().ok()?).ok()?;
    let day = Date::from_calendar_date(year, month, value[8..10].parse().ok()?).ok()?;
    let utc_midnight = day.midnight().assume_utc().unix_timestamp() * 1000;
    let midnight = local_midnight(utc_midnight, &offset_at);
    if let Some(file) = file_ms {
        let next_utc = utc_midnight + 24 * HOUR_MS;
        let start = midnight.min(utc_midnight);
        let end = local_midnight(next_utc, &offset_at).max(next_utc);
        if file >= start && file < end {
            return Some(file);
        }
    }
    Some(midnight)
}

/// Local 00:00 of the day whose UTC midnight is `utc_midnight` (ms). Two passes
/// find the offset in force at local midnight; when a DST jump skips midnight,
/// the first instant after the gap wins (what a JS `new Date(y, m, d)` gives).
fn local_midnight(utc_midnight: i64, offset_at: &impl Fn(i64) -> i64) -> i64 {
    let at = |ms: i64| offset_at(ms.div_euclid(1000)) * 1000;
    let guess = utc_midnight - at(utc_midnight);
    let offset = at(guess);
    let exact = utc_midnight - offset;
    if at(exact) == offset {
        exact
    } else {
        guess
    }
}

/// The calendar day `utc_secs` falls on in the zone `offset_at` describes.
pub(crate) fn day_stamp(utc_secs: i64, offset_at: impl Fn(i64) -> i64) -> String {
    let local = OffsetDateTime::from_unix_timestamp(utc_secs + offset_at(utc_secs))
        .unwrap_or_else(|_| OffsetDateTime::now_utc());
    let day = local.date();
    format!(
        "{:04}-{:02}-{:02}",
        day.year(),
        u8::from(day.month()),
        day.day()
    )
}

/// This Mac's UTC offset (seconds) at `utc_secs`, DST included. The `time`
/// crate refuses a local offset once a process has threads, so ask libc, whose
/// `localtime_r` is thread-safe; a failed lookup reads as UTC.
#[cfg(unix)]
fn local_offset_secs(utc_secs: i64) -> i64 {
    let t = utc_secs as libc::time_t;
    // SAFETY: `tm` is plain C data, zero-initialised, and only written by
    // localtime_r; both pointers are valid for the call.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let filled = unsafe { !libc::localtime_r(&t, &mut tm).is_null() };
    if filled {
        tm.tm_gmtoff as i64
    } else {
        0
    }
}

#[cfg(not(unix))]
fn local_offset_secs(_utc_secs: i64) -> i64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE_MS: i64 = 60_000;
    // offsets across the inhabited range, half-hour and quarter-hour zones too
    const OFFSETS_MIN: [i64; 10] = [-720, -600, -420, -240, 0, 60, 330, 345, 540, 840];

    /// A zone with one fixed offset (minutes east of UTC).
    fn fixed(minutes: i64) -> impl Fn(i64) -> i64 {
        move |_| minutes * 60
    }

    /// A note written now is dated with the writer's own day; read back with
    /// its file time it is "just now", and a minute later a minute old — in
    /// every zone, at every hour (a day is never read as hours since UTC 00:00).
    #[test]
    fn a_note_dated_today_reads_minutes_old_in_every_zone() {
        // 2026-10-03T00:00:00Z, then every half hour through the next day
        let base = 1_790_985_600_000_i64;
        for minutes in OFFSETS_MIN {
            for step in 0..96 {
                let written = base + step * HOUR_MS / 2;
                let day = day_stamp(written / 1000, fixed(minutes));
                let read = stamp_to_ms_in(&day, Some(written), fixed(minutes)).unwrap();
                assert_eq!(read, written, "UTC{minutes:+}min, +{step}x30m: {day}");
                let later = written + MINUTE_MS;
                assert!(later - read <= MINUTE_MS, "UTC{minutes:+}min: {day} aged {}ms", later - read);
            }
        }
    }

    /// The writer's day follows the zone, not a fixed one: 02:30Z on Oct 3 is
    /// still Oct 2 in New York and already Oct 3 in Tokyo.
    #[test]
    fn today_is_the_writers_calendar_day() {
        let at = 1_790_994_600; // 2026-10-03T02:30:00Z
        assert_eq!(day_stamp(at, fixed(-240)), "2026-10-02");
        assert_eq!(day_stamp(at, fixed(0)), "2026-10-03");
        assert_eq!(day_stamp(at, fixed(540)), "2026-10-03");
        assert_eq!(day_stamp(at, fixed(-720)), "2026-10-02");
    }

    /// A reset file time (a clone, a copy) never turns the day into an hour
    /// count against UTC: the stamp is local midnight of its day.
    #[test]
    fn without_a_matching_file_time_a_day_is_local_midnight() {
        let utc_midnight = 1_790_899_200_000_i64; // 2026-10-02T00:00:00Z
        for minutes in OFFSETS_MIN {
            let expected = utc_midnight - minutes * MINUTE_MS;
            let years_later = utc_midnight + 400 * 24 * HOUR_MS;
            for file in [None, Some(0), Some(years_later)] {
                assert_eq!(
                    stamp_to_ms_in("2026-10-02", file, fixed(minutes)),
                    Some(expected),
                    "UTC{minutes:+}min, file {file:?}"
                );
            }
        }
    }

    #[test]
    fn the_file_time_window_is_the_local_day_widened_to_the_utc_day() {
        let utc_midnight = 1_790_899_200_000_i64; // 2026-10-02T00:00:00Z
        let next_utc = utc_midnight + 24 * HOUR_MS;
        // UTC: the window is exactly the UTC day.
        let utc = |file: i64| stamp_to_ms_in("2026-10-02", Some(file), fixed(0));
        assert_eq!(utc(utc_midnight), Some(utc_midnight));
        assert_eq!(utc(next_utc - 1), Some(next_utc - 1));
        assert_eq!(utc(utc_midnight - 1), Some(utc_midnight));
        assert_eq!(utc(next_utc), Some(utc_midnight));
        // New York (UTC−4): the local day runs past the UTC day; a file touched
        // the next morning UTC (a move or copy of yesterday's note) still falls
        // in the local day, but one touched after local midnight does not.
        let ny_midnight = utc_midnight + 4 * HOUR_MS;
        let ny = |file: i64| stamp_to_ms_in("2026-10-02", Some(file), fixed(-240));
        assert_eq!(ny(utc_midnight), Some(utc_midnight));
        assert_eq!(ny(next_utc + 4 * HOUR_MS - 1), Some(next_utc + 4 * HOUR_MS - 1));
        assert_eq!(ny(next_utc + 4 * HOUR_MS), Some(ny_midnight));
        // Tokyo (UTC+9): the local day starts 9h before the UTC day and the
        // UTC widening keeps the rest of the UTC day.
        let tokyo_midnight = utc_midnight - 9 * HOUR_MS;
        let tokyo = |file: i64| stamp_to_ms_in("2026-10-02", Some(file), fixed(540));
        assert_eq!(tokyo(tokyo_midnight), Some(tokyo_midnight));
        assert_eq!(tokyo(next_utc - 1), Some(next_utc - 1));
        assert_eq!(tokyo(next_utc), Some(tokyo_midnight));
        assert_eq!(tokyo(tokyo_midnight - 1), Some(tokyo_midnight));
    }

    #[test]
    fn full_timestamps_are_taken_as_written_and_non_dates_are_none() {
        let file = Some(0);
        assert_eq!(
            stamp_to_ms_in("2026-06-25T12:00:00Z", file, fixed(-240)),
            Some(1_782_388_800_000)
        );
        assert_eq!(
            stamp_to_ms_in(" 2026-06-25T12:00:00+02:00 ", file, fixed(0)),
            Some(1_782_381_600_000)
        );
        for bad in ["", "  ", "not-a-date", "2026/06/25", "2026-02-30", "2026-13-01", "+202-06-25", "2026-6-25"] {
            assert_eq!(stamp_to_ms_in(bad, file, fixed(0)), None, "{bad:?}");
        }
    }

    /// A DST jump that skips local midnight lands on the first instant after
    /// the gap (Brazil's old spring-forward: 00:00 −03 became 01:00 −02).
    #[test]
    fn a_skipped_midnight_lands_after_the_gap() {
        let utc_midnight = 1_541_289_600_000_i64; // 2018-11-04T00:00:00Z
        let jump = utc_midnight + 3 * HOUR_MS; // 00:00 −03 == 03:00Z
        let zone = move |secs: i64| if secs * 1000 < jump { -3 * 3600 } else { -2 * 3600 };
        assert_eq!(local_midnight(utc_midnight, &zone), jump);
    }

    /// The real zone lookup agrees with itself: today's local midnight is at
    /// most a day behind now, and a minute-old file reads as a minute old.
    #[test]
    fn the_live_zone_reads_a_fresh_note_as_fresh() {
        let now = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
        let today = today_stamp();
        assert_eq!(stamp_to_ms(&today, Some(now - MINUTE_MS)), Some(now - MINUTE_MS));
        let midnight = stamp_to_ms(&today, None).unwrap();
        assert!(midnight <= now && now - midnight < 25 * HOUR_MS, "{today} → {midnight}");
    }
}
