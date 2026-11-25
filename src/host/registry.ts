// The front end's host seam. Standalone Rotli registers nothing and behaves
// exactly as it always has. A host build registers once, from a module its
// own entry imports before Rotli's `src/main.tsx`, and adds Settings panes,
// says whether notes are part of the app, and supplies the wording a person
// reads where this build declines Rotli's shared state. The registry locks on
// its first read, so what the app rendered with never changes under it.
// docs/architecture/host-seams.md

import type { ComponentType, ReactNode } from "react";

import { EXISTING_VAULT_REFUSAL } from "../lib/appIdentity";

/** A Settings row's glyph, the same shape as Rotli's own (components/glyphs). */
export type HostGlyph = (props: { size?: number }) => ReactNode;

/** One Settings pane a host adds. */
export interface HostSettingsPane {
  /** Unique among every pane, Rotli's included. */
  id: string;
  /** The nav row's name. */
  label: string;
  glyph: HostGlyph;
  /** The pane heading; the label when absent. A host pane's heading is the
   * banner's scenery with no character and no object. */
  title?: string;
  /** The built-in pane this one follows in the nav. Absent, or a pane this
   * build doesn't show: just before About. */
  after?: string;
  /** The pane's body, below its heading. */
  Pane: ComponentType;
}

/** Sentences a host supplies; Rotli's neutral defaults stand in for each. */
export interface HostWords {
  /** Where the standalone build offers "Check for updates". */
  updates?: string;
  /** A picked folder Rotli already uses as a vault. */
  existingVault?: string;
}

export interface AppHost {
  /** Whether notes are part of this app. False: the window is Settings, with
   * no notes panes and no way back to notes. Default true. */
  notes?: boolean;
  settingsPanes?: readonly HostSettingsPane[];
  words?: HostWords;
}

export const DEFAULT_UPDATES_WORDS = "Updates arrive with this app";

export interface HostRegistry {
  register(host: AppHost): void;
  read(): AppHost | null;
}

/** A registry: one host at most, registered before the first read. */
export function createHostRegistry(): HostRegistry {
  let host: AppHost | null = null;
  let locked = false;
  return {
    register(next) {
      if (locked) throw new Error("A host registers before the app starts");
      if (host) throw new Error("A host is already registered");
      const ids = (next.settingsPanes ?? []).map((pane) => pane.id);
      if (new Set(ids).size !== ids.length) throw new Error("Host Settings panes need unique ids");
      host = Object.freeze({ ...next, settingsPanes: Object.freeze([...(next.settingsPanes ?? [])]) });
    },
    read() {
      locked = true;
      return host;
    },
  };
}

const registry = createHostRegistry();

/** Called by a host build's entry, before Rotli's main module runs. */
export const registerHost = (host: AppHost): void => registry.register(host);

/** The registered host, or null for standalone Rotli. */
export const appHost = (): AppHost | null => registry.read();

/** Whether notes are part of this app (always, without a host). */
export function notesOn(host: AppHost | null = appHost()): boolean {
  return host?.notes !== false;
}

/** The sentence where this build doesn't check the update feed. */
export function updatesWords(host: AppHost | null = appHost()): string {
  return host?.words?.updates ?? DEFAULT_UPDATES_WORDS;
}

/** The sentence for a folder Rotli already uses as a vault. */
export function existingVaultWords(host: AppHost | null = appHost()): string {
  return host?.words?.existingVault ?? EXISTING_VAULT_REFUSAL;
}
