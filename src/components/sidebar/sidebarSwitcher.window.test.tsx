// The Chat segment's two states in the Mac app: Chat here (a quiet control to
// pull it out) and Chat in its own window (the way back). `mock.module` is
// process-wide, so the mock spreads the REAL module and afterAll restores it.

import { afterAll, expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import * as liveShell from "../../services/chatWindowShell";

// a SNAPSHOT of the real exports: the namespace import is live, so after
// mock.module it points at the mocks and "restoring" it would re-install them
const realShell = { ...liveShell };

void mock.module("../../services/chatWindowShell", () => ({ ...realShell, chatWindowSupported: () => true }));
afterAll(() => {
  void mock.module("../../services/chatWindowShell", () => realShell);
});

const { ChatWindowSegment, SidebarSwitcher } = await import("./sidebarSwitcher");

test("with Chat in main, the segment is an ordinary front with a control to pull it out", () => {
  const markup = renderToStaticMarkup(<SidebarSwitcher value="chat" onPick={() => {}} />);
  expect(markup).toContain('aria-label="Pull Chat out into its own window"');
  expect(markup).not.toContain("Put Chat back");
  expect(markup).toMatch(/aria-pressed="true"[^>]*data-tour="chat"/);
  // Home has no such control: main is where Home lives
  expect(markup.match(/sb-switch-window/g)).toHaveLength(1);
});

test("with Chat in its own window, the segment is not a front here and offers the way back", () => {
  // (a static render reads a store's INITIAL state, so the out state is proved
  // on the presentational segment, which takes it as a prop)
  const markup = renderToStaticMarkup(
    <ChatWindowSegment
      detached
      active
      hint="hint"
      action="modules.chat"
      onPick={() => {}}
      onPullOut={() => {}}
    />,
  );
  expect(markup).toContain('aria-label="Put Chat back in this window"');
  expect(markup).toContain("Chat is in its own window — click to bring it forward");
  expect(markup).toMatch(/aria-pressed="false"[^>]*data-tour="chat"/);
  expect(markup).toContain('class="sb-switch-chat out"');
});
