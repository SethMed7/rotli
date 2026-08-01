// The rotli quokka character set — line-art illustrations that appear ONLY in
// the "quokka world" placements: onboarding, empty states, and section/about
// flourishes (never the editor, never notifications — the brand placement law).
// Each vendored SVG is a single `currentColor` path, so the LINE color follows
// the theme (set `color` on the wrapper) while the SHAPE stays constant — exactly
// Seth's rule (2026-06-26). The mark (upper-body quokka) is the in-app logo.
//
// The full-size poses live in characterArt.ts behind a dynamic import (perf
// audit 2026-07-30, #6: ~450 KB of inlined markup was 29% of the entry chunk).
// They stay ?raw inline SVG — tinting survives; only the LOADING moved. The
// wrapper span reserves its box, so the one async tick never shifts layout.
// The bold logo mark stays eager: it's ~6 KB and sits in the titlebar at
// first paint.

import { useEffect, useState } from "react";

import logoMark from "../assets/characters/_logo-bold.svg?raw";
import type { CharacterName } from "./characterArt";

export type { CharacterName } from "./characterArt";

let artCache: Record<CharacterName, string> | null = null;
let artPromise: Promise<Record<CharacterName, string>> | null = null;

function loadArt(): Promise<Record<CharacterName, string>> {
  artPromise ??= import("./characterArt").then((m) => {
    artCache = m.SVGS;
    return m.SVGS;
  });
  return artPromise;
}

interface CharacterProps {
  name: CharacterName;
  size?: number;
  className?: string;
}

/** A quokka character illustration. Inherits `color` for its line color (so a
 * parent can tune it per theme/surface); defaults to the surface text color. */
export function Character({ name, size = 120, className }: CharacterProps) {
  const [art, setArt] = useState(artCache);
  useEffect(() => {
    if (art) return;
    let live = true;
    void loadArt().then((a) => {
      if (live) setArt(a);
    });
    return () => {
      live = false;
    };
  }, [art]);
  return (
    <span
      className={className ? `quokka ${className}` : "quokka"}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: art?.[name] ?? "" }}
    />
  );
}

/** The compact rotli mark — the upper-body quokka used as the in-app logo
 * (titlebar identity, about). Same currentColor line so it tints with the theme. */
export function QuokkaMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `quokka-mark ${className}` : "quokka-mark"}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: logoMark }}
    />
  );
}
