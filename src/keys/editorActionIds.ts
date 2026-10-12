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
  alignLeft: "editor.alignLeft",
  alignCenter: "editor.alignCenter",
  alignRight: "editor.alignRight",
} as const;

/** Shared action names for search and formatting controls. */
export const EDITOR_ACTION_LABEL = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strike: "Strikethrough",
  code: "Inline code",
  highlight: "Highlight",
  link: "Link",
  quote: "Quote",
  bulletList: "Bulleted list",
  numberedList: "Numbered list",
  checklist: "Checklist",
  alignLeft: "Align left",
  alignCenter: "Align center",
  alignRight: "Align right",
} as const;
