// Note templates (1.3.0). A template is an ordinary Markdown note that lives in
// the Templates folder — `wiki/Templates` in a memex vault, `Templates` in a
// plain notes folder (the Welcome folder's layout twin). Nothing about it is
// special on disk: no frontmatter key, no `.rotli/` state. It is made, edited,
// moved and trashed like any note, and `/template` lists what is in the folder.

import { noteDiskFolder } from "../lib/noteLocation";
import type { NoteSummary } from "../types";

export const TEMPLATES_FOLDER = "Templates";
export const TEMPLATES_BRAIN_FOLDER = "wiki/Templates";

/** The PHYSICAL folder decides, never the shelf projection: a template that
 * carries a shelf still projects elsewhere as `folderId`. Subfolders count. */
export function isTemplateFolder(diskFolderId: string): boolean {
  return [TEMPLATES_FOLDER, TEMPLATES_BRAIN_FOLDER].some(
    (root) => diskFolderId === root || diskFolderId.startsWith(`${root}/`),
  );
}

/** What `/template` may offer. A SECURE template is left out: inserting its
 * body would copy protected text into a note that is not. */
export function isTemplateNote(note: NoteSummary): boolean {
  return (note.kind ?? "note") === "note" && !note.secure && isTemplateFolder(noteDiskFolder(note));
}

// ─── built-in presets (the owner, 2026-09-21: "seed some presets which the
// user can turn off in settings") ─────────────────────────────────────────────
// Offered in `/template` beside the vault's own templates, but they are Rotli's,
// not the user's: nothing is written into the vault, so turning them off
// (`templatePresets`) deletes nothing and a vault never gains files it did not
// ask for. Keep one in your Templates folder to change it.

const PRESET_PREFIX = "preset:";

export const TEMPLATE_PRESETS: readonly { id: string; title: string; body: string }[] = [
  {
    id: `${PRESET_PREFIX}meeting`,
    title: "Meeting notes",
    body: "# Meeting notes\n\n**Date:** \n**People:** \n\n## Agenda\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Next steps\n\n- [ ] \n",
  },
  {
    id: `${PRESET_PREFIX}daily`,
    title: "Daily note",
    body: "# Daily note\n\n## Today\n\n- [ ] \n\n## Notes\n\n- \n\n## Tomorrow\n\n- [ ] \n",
  },
  {
    id: `${PRESET_PREFIX}project`,
    title: "Project brief",
    body: "# Project brief\n\n## Goal\n\nWhat this is for, in one or two sentences.\n\n## Scope\n\n- In: \n- Out: \n\n## Milestones\n\n- [ ] \n\n## Open questions\n\n- \n",
  },
  {
    id: `${PRESET_PREFIX}bug`,
    title: "Bug report",
    body: "# Bug report\n\n## What happened\n\n\n## What I expected\n\n\n## Steps to reproduce\n\n1. \n\n## Notes\n\n- \n",
  },
  {
    id: `${PRESET_PREFIX}weekly`,
    title: "Weekly review",
    body: "# Weekly review\n\n## Went well\n\n- \n\n## Didn't\n\n- \n\n## Next week\n\n- [ ] \n",
  },
];

export function isPresetTemplate(id: string): boolean {
  return id.startsWith(PRESET_PREFIX);
}

export function presetTemplateBody(id: string): string | null {
  return TEMPLATE_PRESETS.find((preset) => preset.id === id)?.body ?? null;
}

/** The presets as picker rows — marked by their id, never a real note. */
export function presetTemplateNotes(): NoteSummary[] {
  return TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    title: preset.title,
    snippet: "",
    folderId: TEMPLATES_FOLDER,
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    kind: "note",
  }));
}

/** Where a vault keeps its templates, read off where it just put a new note:
 * a memex files new notes under `wiki/`, a plain folder does not. */
export function templatesFolderBeside(newNoteDiskFolder: string): string {
  return newNoteDiskFolder === "wiki" || newNoteDiskFolder.startsWith("wiki/")
    ? TEMPLATES_BRAIN_FOLDER
    : TEMPLATES_FOLDER;
}
