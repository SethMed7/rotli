import { expect, test } from "bun:test";

import { launchFeatures } from "./featurePolicy";

test("visual diagram editing is unavailable in production and available for development evaluation", () => {
  expect(launchFeatures(false).mermaidVisualEditing).toBe(false);
  expect(launchFeatures(true).mermaidVisualEditing).toBe(true);
});

test("public builds keep notes and chat while every experimental capability stays in development", () => {
  expect(launchFeatures(false)).toEqual({
    notes: true,
    chat: true,
    breve: false,
    mermaidVisualEditing: false,
    agents: false,
    sheets: false,
    mermaidDiagrams: false,
    voice: false,
  });
  expect(launchFeatures(true)).toEqual({
    notes: true,
    chat: true,
    breve: true,
    mermaidVisualEditing: true,
    agents: true,
    sheets: true,
    mermaidDiagrams: true,
    voice: true,
  });
});
