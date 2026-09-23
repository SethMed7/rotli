import { expect, test } from "bun:test";

import { launchFeatures } from "./featurePolicy";

test("visual diagram editing is unavailable in production and available for development evaluation", () => {
  expect(launchFeatures(false).mermaidVisualEditing).toBe(false);
  expect(launchFeatures(true).mermaidVisualEditing).toBe(true);
});

test("public builds keep notes, chat and the Chat window while every experimental capability stays in development", () => {
  expect(launchFeatures(false)).toEqual({
    notes: true,
    chat: true,
    breve: false,
    mermaidVisualEditing: false,
    agents: false,
    sheets: false,
    documents: true,
    mermaidDiagrams: false,
    voice: false,
    chatWindow: true,
  });
  expect(launchFeatures(true)).toEqual({
    notes: true,
    chat: true,
    breve: true,
    mermaidVisualEditing: true,
    agents: true,
    sheets: true,
    documents: true,
    mermaidDiagrams: true,
    voice: true,
    chatWindow: true,
  });
});

test("the web platform withholds every capability that needs the desktop shell, on both channels", () => {
  for (const development of [false, true]) {
    const web = launchFeatures(development, "web");
    expect(web.notes).toBe(true);
    expect(web.chat).toBe(false);
    expect(web.breve).toBe(false);
    expect(web.agents).toBe(false);
    expect(web.sheets).toBe(false);
    // DOCX needs the desktop document lane; the web names it coming soon
    expect(web.documents).toBe(false);
    expect(web.voice).toBe(false);
    // a second browser tab would be a second writer with no coordination
    expect(web.chatWindow).toBe(false);
    // channel-only gates still follow the channel: nothing about them needs Tauri
    expect(web.mermaidVisualEditing).toBe(development);
    expect(web.mermaidDiagrams).toBe(development);
  }
});

test("the desktop platform is the default and is unchanged by the platform axis", () => {
  expect(launchFeatures(true, "desktop")).toEqual(launchFeatures(true));
  expect(launchFeatures(false, "desktop")).toEqual(launchFeatures(false));
});
