// The userName persona line: present in every render site when set, and the
// prompt is byte-identical to the nameless shape when unset (existing users'
// prompts must not move).

import { describe, expect, test } from "bun:test";
import { frontierAdapter, gemmaAdapter } from "./prompt";

const base = {
  web: false,
  knowledge: "",
  history: [],
  userText: "hi",
  scratch: [],
  maxSteps: 4,
};

describe("userName in the prompt", () => {
  test("names the user in both adapters' main prompts", () => {
    for (const adapter of [gemmaAdapter, frontierAdapter]) {
      const named = adapter.renderPrompt({ ...base, userName: "Seth" });
      expect(named).toContain("The user's name is Seth");
    }
  });

  test("names the user in both force-final prompts", () => {
    for (const adapter of [gemmaAdapter, frontierAdapter]) {
      const named = adapter.renderForceFinal({
        history: [],
        userText: "hi",
        scratch: [],
        userName: "Seth",
      });
      expect(named).toContain("The user's name is Seth");
    }
  });

  test("omits the line entirely when unset — prompt shape untouched", () => {
    for (const adapter of [gemmaAdapter, frontierAdapter]) {
      expect(adapter.renderPrompt({ ...base })).not.toContain("The user's name");
      expect(adapter.renderPrompt({ ...base })).toBe(adapter.renderPrompt({ ...base, userName: "" }));
    }
  });
});
