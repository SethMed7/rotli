/** The editor's formatting action ids — ONE definition shared by the action
 * registry (bindings, palette) and the format bar (buttons). They used to be
 * twenty raw string literals restated in both files; a rename in one silently
 * desynced the other (2026-09-01). */
export const EDITOR_ACTION = {
  bold: "editor.bold",
  italic: "editor.italic",
  underline: "editor.underline",
  strike: "editor.strike",
  code: "editor.code",
  highlight: "editor.highlight",
  link: "editor.link",
  quote: "editor.quote",
  bulletList: "editor.bulletList",
  numberedList: "editor.numberedList",
  checklist: "editor.checklist",
} as const;
