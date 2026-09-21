import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SidebarSwitcher } from "./sidebarSwitcher";

test('the Chat segment is named "Chat" — no count rides in its accessible name', () => {
  // the segment has no aria-label, so its name IS its text: a count made it
  // "Chat 3", and a number cannot hold up at a thousand chats
  const markup = renderToStaticMarkup(<SidebarSwitcher value="home" onPick={() => {}} />);
  const labels = [...markup.matchAll(/<span class="sb-switch-label">([^<]*)<\/span>([^<]*)</g)];
  expect(labels.map((m) => `${m[1]}${m[2]}`)).toEqual(["Home", "Chat"]);
});
