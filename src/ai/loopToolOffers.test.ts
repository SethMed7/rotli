import { expect, test } from "bun:test";

import { allowedTools } from "./loop";
import { renderNativeSystem } from "./nativePrompt";
import { frontierAdapter, gemmaAdapter } from "./prompt";
import { registeredToolSpecs } from "./toolSchemas";
import type { RunInput, ToolName } from "./types";

test("web build never offers file-reading or document-editing AI tools", () => {
  const input = { documentTool: true } as RunInput;
  expect(allowedTools(input, "research", "web").has("read_file")).toBe(false);
  expect(allowedTools(input, "research", "web").has("edit_document")).toBe(false);
  expect(allowedTools(input, "research", "desktop").has("read_file")).toBe(true);
  expect(allowedTools(input, "research", "desktop").has("edit_document")).toBe(true);
});

test("built prompts name only tools in their offered registry", () => {
  const names = [
    ...new Set([
      ...registeredToolSpecs().map((spec) => spec.name),
      ...allowedTools(
        { web: true, documentTool: true, artifactTool: true, imageTool: true, boardTool: true } as RunInput,
        "research",
        "desktop",
      ),
    ]),
  ];
  expect(names).toContain("research_web");
  for (const platform of ["web", "desktop"] as const) {
    for (const adapter of [gemmaAdapter, frontierAdapter]) {
      for (const web of [false, true]) {
        for (const extras of [false, true]) {
          const input = {
            web,
            documentTool: extras,
            artifactTool: extras,
            imageTool: extras,
            boardTool: extras,
          } as RunInput;
          const offeredTools = allowedTools(input, adapter.webStrategy, platform);
          const prompt = adapter.renderPrompt({
            web,
            knowledge: "",
            history: [],
            userText: "hi",
            scratch: [],
            maxSteps: 4,
            documentTool: extras,
            artifactTool: extras,
            imageTool: extras,
            boardTool: extras,
            offeredTools,
          });
          const named = names.filter((name) => new RegExp(`\\b${name}\\b`).test(prompt));
          expect(named.filter((name) => !offeredTools.has(name as ToolName))).toEqual([]);
          expect(prompt.includes("read_file")).toBe(platform === "desktop");
          const nativeTools = allowedTools(input, "primitives", platform);
          const nativePrompt = renderNativeSystem({
            offeredTools: nativeTools,
            web,
            knowledge: "",
            maxSteps: 4,
          });
          const nativeNamed = names.filter((name) => new RegExp(`\\b${name}\\b`).test(nativePrompt));
          expect(nativeNamed.filter((name) => !nativeTools.has(name as ToolName))).toEqual([]);
        }
      }
    }
  }
});
