import { expect, test } from "bun:test";

import { launchFeatures } from "./featurePolicy";

test("visual diagram editing is unavailable in production and available for development evaluation", () => {
  expect(launchFeatures(false).mermaidVisualEditing).toBe(false);
  expect(launchFeatures(true).mermaidVisualEditing).toBe(true);
});

test("public builds keep notes and chat while Breve and agent integrations stay in development", () => {
  expect(launchFeatures(false)).toMatchObject({ notes: true, chat: true, breve: false, agents: false });
  expect(launchFeatures(true)).toMatchObject({ notes: true, chat: true, breve: true, agents: true });
});
