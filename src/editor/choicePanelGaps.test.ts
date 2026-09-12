import { expect, test } from "bun:test";

import { Text } from "@codemirror/state";

import { panelEdges } from "./choicePanelGaps";

const doc = (text: string) => Text.of(text.split("\n"));
const flat = (edges: ReturnType<typeof panelEdges>) => edges.map((edge) => `${edge.side}@${edge.pos}`);

test("a panel gets one measured gap above its first row and one below its last", () => {
  const source = doc("intro\n- [##?] Q\n- [##] a\n- [##x] b\n\nafter");
  expect(flat(panelEdges(source))).toEqual([`above@${source.line(2).from}`, `below@${source.line(4).to}`]);
});

test("a promptless group and a nested group each open and close their own gaps", () => {
  const source = doc("- [##] solo\n  - [##] nested\n- [##] back");
  expect(flat(panelEdges(source))).toEqual([
    `above@${source.line(1).from}`,
    `below@${source.line(1).to}`,
    `above@${source.line(2).from}`,
    `below@${source.line(2).to}`,
    `above@${source.line(3).from}`,
    `below@${source.line(3).to}`,
  ]);
});

test("radio rows, tasks and prose add no gaps", () => {
  expect(panelEdges(doc("- [#] a\n- [#x] b\n- [ ] task\n`[##]` literal"))).toHaveLength(0);
});
