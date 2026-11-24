// Offline eval for chat's tag_note (2026-11-24): scripted model replies drive
// the real agent loop, so what a model does when asked to tag a note is
// deterministic. Provider-agnostic: every transport offers the same tool,
// both prompt adapters describe it, and the arguments a model is likely to
// send (a list, a string of words, a leading #) reach the host as words. The
// host's gates are hostTags.test.ts; Rust's lane is corpus_tags_tests.rs.

import { expect, test } from "bun:test";

import { person, promptOf } from "../lib/promptText.fixtures";
import { allowedTools } from "./loop";
import { fakeHost, run } from "./loopHost.fixtures";
import { frontierAdapter, gemmaAdapter } from "./prompt";
import { registeredToolSpecs } from "./toolSchemas";
import type { RunInput } from "./types";

function tagHost(replies: string[]) {
  const tagged: { id: string; add: string[]; remove: string[] }[] = [];
  const { host, calls } = fakeHost(replies, {
    tagNote: async (id: string, add: string[], remove: string[]) => {
      tagged.push({ id, add, remove });
      return `tagged note ${id} — its tags are now: ${add.map((tag) => `#${tag}`).join(" ")}.`;
    },
  });
  return { host, calls, tagged };
}

test("asked to tag a note, the model's tag_note call reaches the host and the answer follows", async () => {
  const { host, calls, tagged } = tagHost([
    '{"thought":"find it","tool":"search_notes","args":{"query":"pricing"}}',
    '{"thought":"tag it","tool":"tag_note","args":{"id":"n1","add":["pricing","q3"]}}',
    '{"final":"Tagged Pricing with #pricing and #q3."}',
  ]);
  const { final } = await run(host, {
    history: [],
    userText: person("Tag my pricing note pricing and q3"),
    web: false,
  });
  expect(tagged).toEqual([{ id: "n1", add: ["pricing", "q3"], remove: [] }]);
  expect(final).toBe("Tagged Pricing with #pricing and #q3.");
  // the tool's answer is what the model saw before it answered
  expect(JSON.stringify(calls.complete.at(-1))).toContain("tagged note n1");
});

test("the arguments a model tends to send arrive as separate words", async () => {
  const { host, tagged } = tagHost([
    '{"tool":"tag_note","args":{"id":"n1","add":"#launch, q3 roadmap","remove":["old","machine learning"]}}',
    '{"final":"done"}',
  ]);
  await run(host, { history: [], userText: person("retag n1"), web: false });
  // a tag to remove stays whole: one on disk may hold a space
  expect(tagged).toEqual([
    { id: "n1", add: ["#launch", "q3", "roadmap"], remove: ["old", "machine learning"] },
  ]);
});

test("a call without an id or any tag is refused before the host is asked", async () => {
  const { host, calls, tagged } = tagHost([
    '{"tool":"tag_note","args":{"id":"n1"}}',
    '{"tool":"tag_note","args":{"add":["x"]}}',
    '{"final":"I could not tag it."}',
  ]);
  await run(host, { history: [], userText: person("tag it"), web: false });
  expect(tagged).toEqual([]);
  expect(JSON.stringify(calls.complete.at(-1))).toContain("tag_note needs an");
});

test("every transport offers tag_note with the note tools, and both prompt styles describe it", () => {
  expect(registeredToolSpecs().map((spec) => spec.name)).toContain("tag_note");
  for (const platform of ["web", "desktop"] as const) {
    for (const adapter of [gemmaAdapter, frontierAdapter]) {
      const offeredTools = allowedTools({ web: false } as RunInput, adapter.webStrategy, platform);
      expect(offeredTools.has("tag_note")).toBe(true);
      const rendered = adapter.renderPrompt({
        web: false,
        knowledge: promptOf(""),
        history: [],
        userText: person("hi"),
        scratch: [],
        maxSteps: 4,
        offeredTools,
      });
      expect(rendered).toContain('"tool":"tag_note"');
    }
  }
});
