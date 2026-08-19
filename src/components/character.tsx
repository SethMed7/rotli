// The rotli quokka character set — canonical illustrations that appear ONLY in
// the "quokka world" placements: onboarding, empty states, and section/about
// flourishes (never the editor, never notifications — the brand placement law).
// Full-body poses can keep their original currentColor line art or use one of
// the filled treatments derived from that exact geometry. The compact mark is
// intentionally always the original line drawing.
//
// The full-size poses live in characterArt.ts behind a dynamic import (perf
// audit 2026-07-30, #6: ~450 KB of inlined markup was 29% of the entry chunk).
// They stay ?raw inline SVG — tinting survives; only the LOADING moved. The
// wrapper span reserves its box, so the one async tick never shifts layout.
// The detailed logo mark stays eager: it's ~6 KB and sits in the titlebar at
// first paint.

import { type CSSProperties, useEffect, useState } from "react";

import logoMark from "../assets/characters/_logo.svg?raw";
import {
  quokkaAccessoryColor,
  quokkaAccessoryPlacement,
  quokkaCustomColor,
  quokkaFill,
  type QuokkaAccessory,
  type QuokkaAccessoryPlacement,
  type QuokkaStyle,
} from "../brand/quokka";
import { useUiStore } from "../state/ui";
import type {
  AccessoryCharacterArt,
  AccessoryCharacterArtSet,
  AccessoryCharacterName,
  CanonicalCharacterName,
  CharacterName,
  ConceptCharacterName,
  LayeredCharacterArt,
  LayeredCharacterName,
} from "./characterArt";

export type { CharacterName } from "./characterArt";

interface CharacterArtBundle {
  line: Record<CanonicalCharacterName, string>;
  masks: Record<CanonicalCharacterName, string>;
  layered: Record<LayeredCharacterName, LayeredCharacterArt>;
  accessories: Record<AccessoryCharacterName, AccessoryCharacterArtSet>;
}

let artCache: CharacterArtBundle | null = null;
let artPromise: Promise<CharacterArtBundle> | null = null;

function loadArt(): Promise<CharacterArtBundle> {
  artPromise ??= import("./characterArt").then((m) => {
    artCache = { line: m.SVGS, masks: m.MASKS, layered: m.LAYERED_ART, accessories: m.ACCESSORY_ART };
    return artCache;
  });
  return artPromise;
}

interface CharacterProps {
  name: CharacterName;
  size?: number;
  className?: string;
  treatment?: QuokkaStyle;
  /** Explicit accessory for previews. */
  accessory?: QuokkaAccessory;
  /** Use the user's chosen accessory on this eligible product placement. */
  accessorized?: boolean;
  /** Onboarding is character-led even when the optional product companion is off. */
  alwaysVisible?: boolean;
  /** Use the user's preferred idle mood instead of the supplied fallback pose. */
  personalIdle?: boolean;
}

function maskStyle(source: string): CSSProperties {
  return {
    maskImage: `url("${source}")`,
    WebkitMaskImage: `url("${source}")`,
  };
}

function accessoryMaskStyle(source: string, placement: QuokkaAccessoryPlacement): CSSProperties {
  return {
    ...maskStyle(source),
    transformOrigin: `${(placement.originX / 512) * 100}% ${(placement.originY / 512) * 100}%`,
    transform: `translate(${(placement.translateX / 512) * 100}%, ${(placement.translateY / 512) * 100}%) rotate(${placement.rotate}deg) scale(${placement.scaleX}, ${placement.scaleY})`,
  };
}

const BUCKET_HAT_OCCLUSION_EDGE = {
  front: [
    [155, 92],
    [156, 105],
    [200, 124],
    [256, 130],
    [312, 124],
    [356, 105],
    [357, 92],
  ],
  "three-quarter": [
    [158, 94],
    [162, 107],
    [207, 128],
    [258, 132],
    [316, 128],
    [364, 112],
    [366, 100],
  ],
  side: [
    [186, 94],
    [194, 111],
    [241, 130],
    [292, 132],
    [345, 128],
    [383, 111],
    [381, 99],
  ],
} as const;

function bucketHatAngle(pose: CharacterName): keyof typeof BUCKET_HAT_OCCLUSION_EDGE {
  if (pose === "walking") return "side";
  if (pose === "thoughtful" || pose === "listening") return "three-quarter";
  return "front";
}

function placedAccessoryPoint(
  [x, y]: readonly [number, number],
  placement: QuokkaAccessoryPlacement,
): readonly [number, number] {
  const radians = (placement.rotate * Math.PI) / 180;
  const scaledX = (x - placement.originX) * placement.scaleX;
  const scaledY = (y - placement.originY) * placement.scaleY;
  return [
    placement.originX + placement.translateX + scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
    placement.originY + placement.translateY + scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
  ];
}

function clipPoint([x, y]: readonly [number, number]): string {
  return `${((x / 512) * 100).toFixed(2)}% ${((y / 512) * 100).toFixed(2)}%`;
}

/** A worn hat fully covers the ears and crown. Clip every body treatment along
 * the selected brim's curved lower edge so neither fill, ink, nor preserved
 * raster detail can poke back through the accessory. */
function bucketHatBodyClip(placement: QuokkaAccessoryPlacement, pose: CharacterName): string {
  const edge = BUCKET_HAT_OCCLUSION_EDGE[bucketHatAngle(pose)].map((point) =>
    placedAccessoryPoint(point, placement),
  );
  const first = edge[0]!;
  const last = edge[edge.length - 1]!;
  const boundary = edge.map(clipPoint).join(", ");
  return `polygon(0 0, ${((first[0] / 512) * 100).toFixed(2)}% 0, ${boundary}, ${((last[0] / 512) * 100).toFixed(2)}% 0, 100% 0, 100% 100%, 0 100%)`;
}

/** A full-body quokka illustration. Without an explicit treatment it follows
 * the user's Appearance preference across every product placement. */
export function Character({
  name,
  size = 120,
  className,
  treatment,
  accessory,
  accessorized = true,
  alwaysVisible = false,
  personalIdle = false,
}: CharacterProps) {
  const companionEnabled = useUiStore((s) => s.quokkaCompanionEnabled);
  const preferredTreatment = useUiStore((s) => s.quokkaStyle);
  const customHue = useUiStore((s) => s.quokkaCustomHue);
  const lineColor = useUiStore((s) => s.quokkaLineColor);
  const preferredAccessory = useUiStore((s) => s.quokkaAccessory);
  const accessoryHue = useUiStore((s) => s.quokkaAccessoryHue);
  const idlePose = useUiStore((s) => s.quokkaIdlePose);
  const resolvedTreatment = treatment ?? preferredTreatment;
  const resolvedAccessory = accessory ?? (accessorized ? preferredAccessory : "none");
  const resolvedName = personalIdle ? idlePose : name;
  const fill = quokkaFill(resolvedTreatment);
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

  if (!companionEnabled && !alwaysVisible) return null;

  const canonicalName = resolvedName as CanonicalCharacterName;
  const canonicalLine = art?.line[canonicalName];
  const layeredName: LayeredCharacterName | null = canonicalLine
    ? null
    : (resolvedName as ConceptCharacterName);
  const layered = layeredName ? art?.layered[layeredName] : null;
  const accessoryArtSet =
    resolvedAccessory === "none" ? null : art?.accessories[resolvedAccessory as AccessoryCharacterName];
  const accessoryArt: AccessoryCharacterArt | null = accessoryArtSet
    ? (accessoryArtSet.poses?.[resolvedName] ?? accessoryArtSet)
    : null;
  const accessoryPlacement = quokkaAccessoryPlacement(resolvedName, resolvedAccessory);
  const bodyHatClip =
    resolvedAccessory === "bucket-hat"
      ? { clipPath: bucketHatBodyClip(accessoryPlacement, resolvedName) }
      : undefined;
  const style = {
    width: size,
    height: size,
    "--quokka-custom-color": quokkaCustomColor(customHue),
    "--quokka-accessory-color": quokkaAccessoryColor(accessoryHue),
    "--quokka-ink": `var(--quokka-line-${lineColor})`,
    ...(fill ? { "--quokka-fill": fill } : {}),
  } as CSSProperties;
  const accessoryLayers = accessoryArt ? (
    <>
      {fill && (
        <span
          className="quokka-layer quokka-accessory-layer"
          style={accessoryMaskStyle(accessoryArt.color, accessoryPlacement)}
        />
      )}
      <span
        className="quokka-layer quokka-ink-layer"
        style={accessoryMaskStyle(accessoryArt.ink, accessoryPlacement)}
      />
    </>
  ) : null;

  return (
    <span className={className ? `quokka ${className}` : "quokka"} style={style} aria-hidden="true">
      {layered && fill && (
        <span
          className="quokka-layer quokka-body-layer"
          style={{ ...maskStyle(layered.body), ...bodyHatClip }}
        />
      )}
      {canonicalLine && fill && (
        <span
          className="quokka-layer quokka-body-layer"
          style={{ ...maskStyle(art.masks[canonicalName]), ...bodyHatClip }}
        />
      )}
      {accessoryPlacement.depth === "under-ink" && accessoryLayers}
      {layered ? (
        <>
          <span
            className="quokka-layer quokka-ink-layer"
            style={{ ...maskStyle(layered.line), ...bodyHatClip }}
          />
          <img
            className="quokka-detail-layer"
            src={layered.detail}
            style={bodyHatClip}
            alt=""
            draggable={false}
          />
        </>
      ) : (
        canonicalLine && (
          <span
            className="quokka-line"
            style={bodyHatClip}
            dangerouslySetInnerHTML={{ __html: canonicalLine }}
          />
        )
      )}
      {accessoryPlacement.depth === "over-ink" && accessoryLayers}
    </span>
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
