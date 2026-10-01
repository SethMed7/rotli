// The sidebar's look (the owner, 2026-10-01): "make the left menu alive via
// scenery … head and footer scenes, both, very subtle", and "for the icons
// allow Neutral, which makes them all fit in, or Color, which uses their own
// color". Pure: the choices, their defaults, and each file kind's icon class.

import { DOCUMENT_EXTS, WORD_EXTS } from "../documents/kinds";
import { IMAGE_EXTS } from "./fileKind";

export const SIDEBAR_SCENERY = ["off", "top", "bottom", "both"] as const;
export type SidebarScenery = (typeof SIDEBAR_SCENERY)[number];
export const SIDEBAR_ICONS = ["neutral", "color"] as const;
export type SidebarIcons = (typeof SIDEBAR_ICONS)[number];

export interface SidebarLook {
  scenery: SidebarScenery;
  icons: SidebarIcons;
}

/** A quiet scene at the top, icons that all fit in. */
export const DEFAULT_SIDEBAR_LOOK: SidebarLook = { scenery: "top", icons: "neutral" };

/** The saved look read tolerantly: anything unknown is the default. */
export function parseSidebarLook(value: unknown): SidebarLook {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    scenery: SIDEBAR_SCENERY.includes(raw.scenery as SidebarScenery)
      ? (raw.scenery as SidebarScenery)
      : DEFAULT_SIDEBAR_LOOK.scenery,
    icons: SIDEBAR_ICONS.includes(raw.icons as SidebarIcons)
      ? (raw.icons as SidebarIcons)
      : DEFAULT_SIDEBAR_LOOK.icons,
  };
}

export const showsTop = (scenery: SidebarScenery) => scenery === "top" || scenery === "both";
export const showsBottom = (scenery: SidebarScenery) => scenery === "bottom" || scenery === "both";

/** A folder row's icon class (Color mode tints it like a board). */
export const FOLDER_ICON_KIND = "kind-folder";

/** A row's file kind, for its icon's color in Color mode (`kind-<kind>`). */
export function iconKind(note: {
  kind?: "note" | "board" | "file" | undefined;
  title?: string | undefined;
}): string {
  if (note.kind === "board") return "board";
  if (note.kind !== "file") return "note";
  const ext = (note.title ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "svg") return "svg";
  if (WORD_EXTS.has(ext)) return "word";
  if (DOCUMENT_EXTS.has(ext)) return "doc";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "note";
}
