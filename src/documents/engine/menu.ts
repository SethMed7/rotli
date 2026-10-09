/** Univer controls whose changes Rotli's Word codec can't save (headers and
 * footers, page setup, the page/modern mode, horizontal rules, checklists, the
 * paragraph-settings panel, H4/H5): hidden everywhere, so nothing a person
 * does in the editor is lost on the next save (2026-10-01, the Univer
 * review). A control comes back when the codec learns to write it. */
export const UNSAVABLE_MENU = Object.fromEntries(
  [
    "doc.command.open-header-footer-panel",
    "doc.command.core-header-footer",
    "doc.command.switch-mode",
    "docs.operation.open-page-setting",
    "doc.command.horizontal-line",
    "doc.command.insert-horizontal-line-bellow",
    "doc.command.check-list",
    "doc.command.insert-check-list-bellow",
    "doc-paragraph-setting.command",
    "doc.command.h4-heading",
    "doc.command.h5-heading",
  ].map((id) => [id, { hidden: true }]),
);
