// WhichKey — the "hold ⌘ to see the shortcut map" overlay (the maintainer, 2026-06-13).
// A NON-MODAL, non-dimming peek: a light floating panel that fades in while ⌘ is
// held idle, showing every main-surface, currently-bound chord grouped by area.
// It reads the registry READ-ONLY (allActions / currentChord / formatChord) —
// it never binds, dispatches, or touches the dispatcher hot path. Releasing ⌘,
// pressing any key, or clicking dismisses it (the hook in App.tsx owns that);
// onClose is here for symmetry with the other overlays.
//
// Layout law (from the approved gates): rows reuse .prow/.hint/kbd from the ⌘K
// palette so the chord hints read identically; the panel sits BELOW the palette
// in z-order and is pointer-events:none so it can never steal a click. No raw
// hex — kit tokens + the palette's cocoa shadow value.

import { useMemo } from "react";

import { formatChord } from "../keys/chords";
import { type KeyAction, type Surface, allActions, currentChord } from "../keys/registry";

/** Whether this map lists an action: the same surfaces its dispatcher fires
 * it on — its own, opted in (`also`: ⌘⇧L in the Quick Note), or `shared`
 * (the editor's format chords). Global chords are OS-side. Pure for tests. */
export function mapsOn(
  action: Pick<KeyAction, "surface" | "also" | "shared" | "global">,
  surface: Surface,
): boolean {
  if (action.global === true) return false;
  return action.shared === true || action.surface === surface || (action.also?.includes(surface) ?? false);
}

/** The picker's row jumps collapse to one line per half (⌘1–⌘9, ⌘⇧1–⌘⇧9)
 * only while all nine are bound; after any rebinding each bound jump shows
 * on its own, so none disappears from the map. */
export function pickRangeRows(bound: (row: number) => string | null): {
  ranges: { key: string; title: string; chord: string }[];
  singles: number[];
} {
  const ranges: { key: string; title: string; chord: string }[] = [];
  const singles: number[] = [];
  for (const [key, title, from, to] of [
    ["quick.pick.low", "Picker — open row 1–9", 1, 9],
    ["quick.pick.high", "Picker — open row 10–18", 10, 18],
  ] as const) {
    const rows = Array.from({ length: to - from + 1 }, (_unused, index) => from + index);
    const first = bound(from);
    const last = bound(to);
    if (first && last && rows.every((row) => bound(row))) {
      ranges.push({ key, title, chord: `${first}–${last}` });
    } else {
      singles.push(...rows.filter((row) => bound(row)));
    }
  }
  return { ranges, singles };
}

/** The friendly area cards, in display order, each matched by id prefix. The
 * representative tab-jump row collapses tabs.jump1…8 into one line. */
const AREAS: { label: string; match: (id: string) => boolean }[] = [
  { label: "App", match: (id) => id.startsWith("app.") },
  { label: "Search & Palette", match: (id) => id.startsWith("palette.") },
  { label: "View", match: (id) => id.startsWith("view.") },
  { label: "Theme", match: (id) => id.startsWith("theme.") },
  { label: "Notes", match: (id) => id.startsWith("notes.") },
  { label: "Tabs", match: (id) => id.startsWith("tabs.") },
  { label: "Panes", match: (id) => id.startsWith("panes.") },
  { label: "Sidebar", match: (id) => id.startsWith("chrome.") },
  { label: "Editor", match: (id) => id.startsWith("editor.") },
  { label: "Quick note", match: (id) => id.startsWith("quick.") },
];

interface WkRow {
  key: string;
  title: string;
  /** The Mac-symbol chord, already formatted (e.g. "⌥⌘F"). */
  chord: string;
}

interface WkArea {
  label: string;
  rows: WkRow[];
}

export function WhichKey({
  onClose: _onClose,
  surface = "main",
}: {
  onClose: () => void;
  /** Which window's keys to map — the Quick Note window maps only its own. */
  surface?: "main" | "quick";
}) {
  const areas = useMemo<WkArea[]>(() => {
    // only this surface's non-global, currently-bound actions — unbound ones
    // are noise in a "what can I press" map (modules.* / editor.* mostly unbound).
    const visible = allActions().filter((a) => mapsOn(a, surface) && currentChord(a.id) !== null);

    const out: WkArea[] = [];
    for (const area of AREAS) {
      const inArea = visible.filter((a) => area.match(a.id));
      if (inArea.length === 0) continue;

      const rows: WkRow[] = [];
      // collapse the eight tab-jumps into ONE representative row, and the
      // Quick Note picker's eighteen row jumps into two
      const jumps = inArea.filter((a) => /^tabs\.jump[1-8]$/.test(a.id));
      const picks = inArea.filter((a) => /^quick\.pick\d+$/.test(a.id));
      const rest = inArea.filter((a) => !/^tabs\.jump[1-8]$/.test(a.id) && !picks.includes(a));

      for (const a of rest) {
        const chord = currentChord(a.id);
        if (chord) rows.push({ key: a.id, title: a.title, chord: formatChord(chord) });
      }
      if (jumps.length > 0) {
        // representative: the friendly title + the ⌘1–⌘8 range as the hint
        const first = currentChord("tabs.jump1");
        const last = currentChord(`tabs.jump${jumps.length}`);
        const range = first && last ? `${formatChord(first)}–${formatChord(last)}` : "⌘1–⌘8";
        rows.push({ key: "tabs.jump", title: "Go to tab 1–8", chord: range });
      }
      if (picks.length > 0) {
        const bound = (row: number) => {
          const chord = currentChord(`quick.pick${row}`);
          return chord ? formatChord(chord) : null;
        };
        const { ranges, singles } = pickRangeRows(bound);
        rows.push(...ranges);
        for (const row of singles) {
          rows.push({ key: `quick.pick${row}`, title: `Picker — open row ${row}`, chord: bound(row) ?? "" });
        }
      }

      if (rows.length > 0) out.push({ label: area.label, rows });
    }
    return out;
  }, [surface]);

  return (
    <div className="whichkey" role="presentation" aria-hidden="true">
      <div className="wk-panel">
        {areas.map((area) => (
          <div className="wk-area" key={area.label}>
            <div className="pal-sec">{area.label}</div>
            {area.rows.map((row) => (
              <div className="prow" key={row.key}>
                <span className="plabel">{row.title}</span>
                <span className="hint">
                  <kbd>{row.chord}</kbd>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
