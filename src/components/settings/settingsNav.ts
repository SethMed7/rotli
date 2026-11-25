// Settings' left nav as data: Rotli's own panes in their fixed order, which
// of them belong to notes, and where a host's panes go
// (src/host/registry.ts). With no host the result is exactly Rotli's list.

import type { ReactNode } from "react";

import { type AppHost, type HostSettingsPane, aboutLabel } from "../../host/registry";
import type { Platform } from "../../lib/featurePolicy";
import { QuokkaMark } from "../character";
import {
  BrowserGlyph,
  ChatGlyph,
  CloudGlyph,
  DatabaseGlyph,
  ExternalLinkGlyph,
  KeyboardGlyph,
  LaptopGlyph,
  NotesStackGlyph,
  ShieldGlyph,
  SunGlyph,
} from "../glyphs";

export type BuiltinPane =
  | "general"
  | "hotkeys"
  | "appearance"
  | "browser"
  | "brain"
  | "security"
  | "models"
  | "chat"
  | "location"
  | "connections"
  | "about";

type Glyph = (props: { size?: number }) => ReactNode;

export const BUILTIN_NAV: readonly { id: BuiltinPane; label: string; glyph: Glyph }[] = [
  { id: "general", label: "General", glyph: LaptopGlyph },
  { id: "hotkeys", label: "Keybindings", glyph: KeyboardGlyph },
  { id: "appearance", label: "Appearance", glyph: SunGlyph },
  { id: "browser", label: "Browser", glyph: BrowserGlyph },
  // the organizer daemon's trust ladder (design §4.3) — minimal Phase-4 pane;
  // capability checkboxes / Pause / Reset Brain are Phase 5 (§4.8)
  { id: "brain", label: "Librarian", glyph: NotesStackGlyph },
  // the secure-note explainer (decision 2026-07-22, feature C) — the ONE plain-
  // language home for the fail-closed rules; contract stays the spec
  { id: "security", label: "Security", glyph: ShieldGlyph },
  // connected subscription models + hybrid presets (the maintainer, 2026-07-02)
  { id: "models", label: "AI Models", glyph: CloudGlyph },
  // how chats start and get their names (the owner, 2026-09-21)
  { id: "chat", label: "Chat", glyph: ChatGlyph },
  // Storage + Memory collapsed into one "Location" tab (the maintainer, 2026-06-27): your
  // notes folder *is* (or can become) a brain — one concept, not two overlapping
  // ones. See LocationPane in settingsSurface.tsx.
  { id: "location", label: "Location", glyph: DatabaseGlyph },
  { id: "connections", label: "Connections", glyph: ExternalLinkGlyph },
  { id: "about", label: "About Rotli", glyph: QuokkaMark },
];

/** Rotli Web has no app hotkeys (featurePolicy `hotkeys`), so no Keybindings
 * pane, and no private browser, so no Browser pane. */
const WEB_HIDDEN_PANES: ReadonlySet<BuiltinPane> = new Set(["hotkeys", "browser"]);

/** The panes that exist only for notes: a host without notes shows none of
 * them (plan: Keybindings, Browser, Librarian, Security, AI Models, Chat,
 * Location). General, Appearance, Connections and About always show. */
export const NOTES_PANES: ReadonlySet<BuiltinPane> = new Set([
  "hotkeys",
  "browser",
  "brain",
  "security",
  "models",
  "chat",
  "location",
]);

export interface NavEntry {
  id: string;
  label: string;
  glyph: Glyph;
  /** Set for a host's pane; absent for Rotli's own. */
  host?: HostSettingsPane;
}

/** The nav this build shows, top to bottom. */
export function settingsNav(platform: Platform, host: AppHost | null): NavEntry[] {
  const notes = host?.notes !== false;
  const shown: NavEntry[] = BUILTIN_NAV.filter(
    (pane) => !(platform === "web" && WEB_HIDDEN_PANES.has(pane.id)) && (notes || !NOTES_PANES.has(pane.id)),
  ).map((pane) => (pane.id === "about" ? { ...pane, label: aboutLabel(host) } : { ...pane }));
  const taken = new Set<string>(BUILTIN_NAV.map((pane) => pane.id));
  for (const pane of host?.settingsPanes ?? []) {
    if (taken.has(pane.id)) throw new Error(`Settings pane id ${JSON.stringify(pane.id)} is already Rotli's`);
    taken.add(pane.id);
    const entry: NavEntry = { id: pane.id, label: pane.label, glyph: pane.glyph, host: pane };
    const anchor = pane.after === undefined ? -1 : shown.findIndex((row) => row.id === pane.after);
    // after its anchor and any host panes already placed there, in the order given
    let at = anchor;
    if (at >= 0) {
      at += 1;
      while (at < shown.length && shown[at]?.host?.after === pane.after) at += 1;
    } else {
      const about = shown.findIndex((row) => row.id === "about");
      at = about >= 0 ? about : shown.length;
    }
    shown.splice(at, 0, entry);
  }
  return reordered(shown, host?.navOrder ?? [], taken);
}

/** `shown` with the panes `order` names trading places among the slots they
 * hold, in `order`'s order; every other pane keeps its slot. A pane this
 * build doesn't show is skipped; an id no pane has, or one named twice,
 * throws. */
function reordered(shown: NavEntry[], order: readonly string[], known: ReadonlySet<string>): NavEntry[] {
  if (new Set(order).size !== order.length) throw new Error("A Settings nav order names a pane twice");
  const unknown = order.find((id) => !known.has(id));
  if (unknown !== undefined)
    throw new Error(`A Settings nav order names an unknown pane ${JSON.stringify(unknown)}`);
  const named = order.filter((id) => shown.some((row) => row.id === id));
  const queue = named.map((id) => shown.find((row) => row.id === id) as NavEntry);
  return shown.map((row) => (named.includes(row.id) ? (queue.shift() as NavEntry) : row));
}
