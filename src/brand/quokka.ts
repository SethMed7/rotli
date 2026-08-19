/**
 * Machine-level companion choices. Fixed visual values live in the brand layer;
 * product components consume the named choices and never invent character
 * colors locally.
 */

export const QUOKKA_STYLES = ["line", "cocoa", "green", "ocean", "iris", "berry", "amber", "custom"] as const;

export type QuokkaStyle = (typeof QUOKKA_STYLES)[number];

export const QUOKKA_ACCESSORIES = ["none", "glasses", "bucket-hat", "goggles"] as const;

export type QuokkaAccessory = (typeof QUOKKA_ACCESSORIES)[number];

export const QUOKKA_POSES = [
  "base",
  "notes",
  "chat",
  "inbox",
  "board",
  "knowledge",
  "local",
  "rest",
  "waving",
  "searching",
  "celebrating",
  "thoughtful",
  "walking",
  "listening",
  "attention",
] as const;

export type QuokkaPose = (typeof QUOKKA_POSES)[number];

export interface QuokkaAccessoryPlacement {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  originX: number;
  originY: number;
  depth: "under-ink" | "over-ink";
}

interface QuokkaAccessoryMount {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
}

interface QuokkaPoseMounts {
  face: QuokkaAccessoryMount;
  brow: QuokkaAccessoryMount;
  crown: QuokkaAccessoryMount;
  neck: QuokkaAccessoryMount;
}

interface QuokkaAccessoryAdjustment {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
}

function mount(x: number, y: number, scaleX = 1, scaleY = scaleX, rotate = 0): QuokkaAccessoryMount {
  return { x, y, scaleX, scaleY, rotate };
}

/** Character-space landmarks on the shared 512px artboard. Accessories mount
 * to these landmarks so changing pose never leaves eyewear or clothing behind
 * at the neutral drawing's coordinates. Side-profile motion compresses worn
 * art horizontally instead of pretending the face is still front-on. */
const QUOKKA_POSE_MOUNTS: Record<QuokkaPose, QuokkaPoseMounts> = {
  chat: {
    face: mount(253, 137, 0.83),
    brow: mount(251, 103, 0.83),
    crown: mount(247, 97, 0.83),
    neck: mount(252, 236, 0.85),
  },
  base: {
    face: mount(254, 136),
    brow: mount(253, 95),
    crown: mount(248, 89),
    neck: mount(254, 240),
  },
  celebrating: {
    face: mount(258, 145, 0.96),
    brow: mount(257, 105, 0.96),
    crown: mount(253, 99, 0.96),
    neck: mount(257, 249, 0.98),
  },
  board: {
    face: mount(194, 154, 0.8, 0.8, -3),
    brow: mount(190, 120, 0.8, 0.8, -3),
    crown: mount(187, 114, 0.8, 0.8, -3),
    neck: mount(194, 244, 0.82, 0.82, -2),
  },
  inbox: {
    face: mount(252, 134, 0.98),
    brow: mount(251, 94, 0.98),
    crown: mount(246, 88, 0.98),
    neck: mount(252, 236, 0.98),
  },
  knowledge: {
    face: mount(244, 132, 0.95),
    brow: mount(243, 93, 0.95),
    crown: mount(238, 87, 0.95),
    neck: mount(244, 233, 0.95),
  },
  notes: {
    face: mount(253, 134, 0.99),
    brow: mount(252, 94, 0.99),
    crown: mount(247, 88, 0.99),
    neck: mount(253, 236, 0.99),
  },
  rest: {
    face: mount(254, 141),
    brow: mount(253, 100),
    crown: mount(248, 94),
    neck: mount(254, 240),
  },
  searching: {
    face: mount(254, 139),
    brow: mount(253, 98),
    crown: mount(248, 92),
    neck: mount(254, 240),
  },
  local: {
    face: mount(255, 137, 0.99),
    brow: mount(254, 96, 0.99),
    crown: mount(249, 90, 0.99),
    neck: mount(255, 240, 0.99),
  },
  waving: {
    face: mount(261, 138),
    brow: mount(260, 97),
    crown: mount(255, 91),
    neck: mount(260, 241),
  },
  attention: {
    face: mount(256, 136),
    brow: mount(255, 95),
    crown: mount(250, 89),
    neck: mount(256, 239),
  },
  listening: {
    face: mount(284, 149, 0.94, 0.94, -6),
    brow: mount(280, 109, 0.94, 0.94, -6),
    crown: mount(276, 102, 0.94, 0.94, -6),
    neck: mount(270, 242, 0.95, 0.95, -2),
  },
  thoughtful: {
    face: mount(271, 136, 0.9, 0.9, -13),
    brow: mount(262, 96, 0.9, 0.9, -13),
    crown: mount(258, 89, 0.9, 0.9, -13),
    neck: mount(260, 236, 0.9, 0.9, -4),
  },
  walking: {
    face: mount(340, 147, 0.55, 0.9),
    brow: mount(329, 106, 0.6, 0.9),
    crown: mount(303, 94, 0.72, 0.9),
    neck: mount(307, 235, 0.72, 0.9, 3),
  },
};

const QUOKKA_ACCESSORY_MOUNTS = {
  none: { anchor: "face", originX: 256, originY: 144, depth: "over-ink" },
  glasses: { anchor: "face", originX: 256, originY: 144, depth: "over-ink" },
  goggles: { anchor: "brow", originX: 253, originY: 95, depth: "over-ink" },
  "bucket-hat": { anchor: "crown", originX: 248, originY: 89, depth: "over-ink" },
} as const satisfies Record<
  QuokkaAccessory,
  {
    anchor: keyof QuokkaPoseMounts;
    originX: number;
    originY: number;
    depth: QuokkaAccessoryPlacement["depth"];
  }
>;

/** Clothing follows the silhouette rather than borrowing eyewear geometry.
 * The bucket hat keeps its crown seated on the head and inherits each pose's
 * head angle; the short brim stays above the eyes instead of floating across
 * the face. */
const QUOKKA_ACCESSORY_ADJUSTMENTS: Partial<
  Record<QuokkaPose, Partial<Record<QuokkaAccessory, QuokkaAccessoryAdjustment>>>
> = {
  attention: {
    "bucket-hat": { y: -6, scaleX: 0.98, scaleY: 0.98 },
  },
  listening: {
    "bucket-hat": { x: -10, y: -10, scaleX: 1.08, scaleY: 0.96, rotate: 2 },
  },
  thoughtful: {
    "bucket-hat": { x: -4, y: -5, scaleX: 1.04, scaleY: 0.96, rotate: 3 },
  },
  walking: {
    "bucket-hat": { x: 8, y: -8, scaleX: 1.2, scaleY: 1.04 },
  },
};

/** The hat is intentionally a compact accent rather than a second head-sized
 * silhouette. Pose mounts still own its angle and non-uniform perspective. */
const BUCKET_HAT_BASE_SCALE = 0.84;

export function quokkaAccessoryPlacement(
  pose: QuokkaPose,
  accessory: QuokkaAccessory,
): QuokkaAccessoryPlacement {
  const accessoryMount = QUOKKA_ACCESSORY_MOUNTS[accessory];
  const poseMount = QUOKKA_POSE_MOUNTS[pose][accessoryMount.anchor];
  const adjustment = QUOKKA_ACCESSORY_ADJUSTMENTS[pose]?.[accessory];
  const accessoryScale = accessory === "bucket-hat" ? BUCKET_HAT_BASE_SCALE : 1;
  return {
    translateX: poseMount.x - accessoryMount.originX + (adjustment?.x ?? 0),
    translateY: poseMount.y - accessoryMount.originY + (adjustment?.y ?? 0),
    scaleX: poseMount.scaleX * (adjustment?.scaleX ?? 1) * accessoryScale,
    scaleY: poseMount.scaleY * (adjustment?.scaleY ?? 1) * accessoryScale,
    rotate: poseMount.rotate + (adjustment?.rotate ?? 0),
    originX: accessoryMount.originX,
    originY: accessoryMount.originY,
    depth: accessoryMount.depth,
  };
}

export const QUOKKA_LINE_COLORS = ["black", "white"] as const;

export type QuokkaLineColor = (typeof QUOKKA_LINE_COLORS)[number];

export const DEFAULT_QUOKKA_CUSTOM_HUE = 225;
export const DEFAULT_QUOKKA_ACCESSORY_HUE = 38;

/** Personal placements use this preferred mood. Semantic empty states keep
 * choosing their own pose so the illustration still communicates state. */
export const QUOKKA_IDLE_POSES = ["base", "rest", "thoughtful", "listening", "celebrating"] as const;

export type QuokkaIdlePose = (typeof QUOKKA_IDLE_POSES)[number];

export const QUOKKA_IDLE_POSE_PRESENTATIONS: readonly {
  pose: QuokkaIdlePose;
  label: string;
  description: string;
}[] = [
  { pose: "base", label: "Content", description: "Warm and present" },
  { pose: "rest", label: "Peaceful", description: "Settled and unhurried" },
  { pose: "thoughtful", label: "Thoughtful", description: "Quietly curious" },
  { pose: "listening", label: "Attentive", description: "Ready to listen" },
  { pose: "celebrating", label: "Cheerful", description: "A little brighter" },
];

export const QUOKKA_STYLE_PRESENTATIONS: readonly {
  style: QuokkaStyle;
  label: string;
  description: string;
  color: string | null;
}[] = [
  { style: "line", label: "Line", description: "Original drawing", color: null },
  { style: "cocoa", label: "Cocoa", description: "Warm and familiar", color: "#C6845F" },
  { style: "green", label: "Fern", description: "Calm and fresh", color: "#6FA68B" },
  { style: "ocean", label: "Ocean", description: "Clear and open", color: "#6EABD4" },
  { style: "iris", label: "Iris", description: "Softly expressive", color: "#A58BD9" },
  { style: "berry", label: "Berry", description: "Warm and playful", color: "#C97998" },
  { style: "amber", label: "Amber", description: "Bright, not loud", color: "#D9A84C" },
  { style: "custom", label: "Custom", description: "Your own color", color: null },
];

export const QUOKKA_ACCESSORY_PRESENTATIONS: readonly {
  accessory: QuokkaAccessory;
  label: string;
  description: string;
}[] = [
  { accessory: "none", label: "None", description: "Just the quokka" },
  { accessory: "glasses", label: "Glasses", description: "Quiet librarian" },
  { accessory: "bucket-hat", label: "Bucket hat", description: "Everyday explorer" },
  { accessory: "goggles", label: "Goggles", description: "Ready to search" },
];

const HEX_COLOR = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

export function normalizeQuokkaCustomHue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 359
    ? Math.round(value)
    : DEFAULT_QUOKKA_CUSTOM_HUE;
}

export function normalizeQuokkaAccessoryHue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 359
    ? Math.round(value)
    : DEFAULT_QUOKKA_ACCESSORY_HUE;
}

/** Resolve personalized colors where the character is rendered. Defining a
 * derived custom property only on :root would freeze its fallback hue before a
 * descendant's personalized hue can participate. */
export function quokkaCustomColor(hue: unknown): string {
  return `oklch(68% 0.12 ${normalizeQuokkaCustomHue(hue)})`;
}

export function quokkaAccessoryColor(hue: unknown): string {
  return `oklch(70% 0.15 ${normalizeQuokkaAccessoryHue(hue)})`;
}

/** One-way compatibility for the short-lived native color-well setting. */
export function quokkaHueFromLegacyColor(value: unknown): number {
  if (typeof value !== "string") return DEFAULT_QUOKKA_CUSTOM_HUE;
  const match = HEX_COLOR.exec(value);
  if (!match) return DEFAULT_QUOKKA_CUSTOM_HUE;
  const red = Number.parseInt(match[1] ?? "", 16) / 255;
  const green = Number.parseInt(match[2] ?? "", 16) / 255;
  const blue = Number.parseInt(match[3] ?? "", 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;
  const sector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return Math.round((sector * 60 + 360) % 360);
}

export function quokkaFill(style: QuokkaStyle): string | null {
  if (style === "line") return null;
  if (style === "custom") return "var(--quokka-custom-color)";
  return QUOKKA_STYLE_PRESENTATIONS.find((choice) => choice.style === style)?.color ?? null;
}
