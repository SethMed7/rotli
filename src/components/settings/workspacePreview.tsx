// The small workspace drawings in Settings → Appearance: a sidebar, a page and
// a card, in one environment's colours. Built-in palettes are `.preview-*`
// classes in themes.css; a custom theme passes its derived roles instead.

import type { CSSProperties } from "react";

import type { ThemeFamily } from "../../state/themeChoices";

export type PreviewEnvironment =
  | "warm-light"
  | "warm-dark"
  | "paper"
  | "charcoal"
  | "ocean-light"
  | "ocean-dark"
  | "grove-light"
  | "grove-dark"
  | "iris-light"
  | "iris-dark"
  | "blossom-light"
  | "blossom-dark"
  | "midnight-light"
  | "midnight-dark"
  | "tesven-light"
  | "tesven-dark";

export function previewEnvironment(family: ThemeFamily, mode: "light" | "dark"): PreviewEnvironment {
  if (family === "warm") return mode === "light" ? "warm-light" : "warm-dark";
  if (family === "mono") return mode === "light" ? "paper" : "charcoal";
  return `${family}-${mode}`;
}

/** A custom theme's half: its `--preview-*` roles, set on its own canvas. */
export interface CustomPreviewCanvas {
  mode: "light" | "dark";
  roles: CSSProperties;
}

/** A tiny but believable workspace preview. Fixed preview palettes are defined
 * in themes.css so this component still consumes semantic custom properties. */
export function WorkspacePreview({
  environments,
}: {
  environments: readonly (PreviewEnvironment | CustomPreviewCanvas)[];
}) {
  return (
    <span
      className={environments.length > 1 ? "workspace-preview split" : "workspace-preview"}
      aria-hidden="true"
    >
      {environments.map((environment) => (
        <span
          className={
            typeof environment === "string"
              ? `workspace-preview-canvas preview-${environment}`
              : "workspace-preview-canvas"
          }
          style={typeof environment === "string" ? undefined : environment.roles}
          key={typeof environment === "string" ? environment : `custom-${environment.mode}`}
        >
          <span className="workspace-preview-sidebar">
            <i />
            <i />
            <i className="selected" />
            <i />
          </span>
          <span className="workspace-preview-page">
            <b />
            <i />
            <i />
            <em />
          </span>
        </span>
      ))}
    </span>
  );
}
