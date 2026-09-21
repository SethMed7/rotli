// The Chat segment's two states in the Mac app: Chat here (a quiet control to
// pull it out, and the segment itself drags out) and Chat in its own window
// (no Chat segment at all; the switch's trailing button brings it back).
// `mock.module` is process-wide, so each mock spreads a SNAPSHOT of the real
// module and afterAll restores it.

import { afterAll, expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import * as liveShell from "../../services/chatWindowShell";
import * as liveStore from "../../state/chatWindowStore";

// SNAPSHOTS of the real exports: the namespace import is live, so after
// mock.module it points at the mocks and "restoring" it would re-install them
const realShell = { ...liveShell };
const realStore = { ...liveStore };
let detached = false;

void mock.module("../../services/chatWindowShell", () => ({ ...realShell, chatWindowSupported: () => true }));
void mock.module("../../state/chatWindowStore", () => ({
  ...realStore,
  useChatWindowStore: (select: (state: { detached: boolean }) => unknown) => select({ detached }),
}));
afterAll(() => {
  void mock.module("../../services/chatWindowShell", () => realShell);
  void mock.module("../../state/chatWindowStore", () => realStore);
});

const { SidebarSwitcher, tearOffLanded } = await import("./sidebarSwitcher");

test("with Chat in main, the segment is an ordinary front with a control to pull it out", () => {
  detached = false;
  const markup = renderToStaticMarkup(<SidebarSwitcher value="chat" onPick={() => {}} />);
  expect(markup).toContain('aria-label="Pull Chat out into its own window"');
  expect(markup).not.toContain("Bring Chat back");
  expect(markup).toMatch(/aria-pressed="true"[^>]*data-tour="chat"/);
  // Home has no such control: main is where Home lives
  expect(markup.match(/sb-switch-window/g)).toHaveLength(1);
});

test("with Chat in its own window, main shows no Chat segment — only the way back, last", () => {
  detached = true;
  const markup = renderToStaticMarkup(<SidebarSwitcher value="home" onPick={() => {}} onBreve={() => {}} />);
  expect(markup).not.toContain('data-tour="chat"');
  expect(markup).not.toContain("sb-switch-window");
  expect(markup).toContain('aria-label="Bring Chat back into this window"');
  // the regroup button is the switch's very last control
  expect(markup.lastIndexOf("<button")).toBe(
    markup.indexOf('<button type="button" class="sb-switch-regroup"'),
  );
  detached = false;
});

test("a drag tears Chat off only when released clear of the whole switch", () => {
  const sw = { left: 12, top: 40, right: 268, bottom: 70 };
  // dropped back on the switch, or just beside it: nothing happens
  expect(tearOffLanded(sw, 150, 55)).toBe(false);
  expect(tearOffLanded(sw, 150, 80)).toBe(false);
  // dragged well away — into the sidebar, the notes, or out of the window
  expect(tearOffLanded(sw, 150, 140)).toBe(true);
  expect(tearOffLanded(sw, 400, 55)).toBe(true);
  expect(tearOffLanded(sw, -30, 55)).toBe(true);
});
