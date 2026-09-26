import { describe, expect, test } from "bun:test";

import { buildHandToAiPrompt } from "./handToAi";

const NOTE = [
  "# Ship the onboarding tour",
  "",
  "Make the first-run tour teach the three sidebar sections without a video.",
  "",
  "## Tasks",
  "- [x] Draft the copy",
  "- [/] Record the stills",
  "- [ ] Wire the Next button",
  "  - [ ] Keyboard: → moves on",
  "",
  "Notes: the tour lives in `src/components/onboarding/`.",
].join("\n");

describe("Hand to AI prompt", () => {
  test("names the note, states the goal, and splits open from done tasks", () => {
    const prompt = buildHandToAiPrompt({ title: "Ship the onboarding tour", body: NOTE });
    expect(prompt).toContain('my note "Ship the onboarding tour"');
    expect(prompt).toContain(
      "## Goal\n\nMake the first-run tour teach the three sidebar sections without a video.",
    );
    expect(prompt).toContain(
      "## Open tasks\n\n- [ ] Record the stills (in progress)\n- [ ] Wire the Next button\n- [ ] Keyboard: → moves on",
    );
    expect(prompt).toContain("## Already done\n\n- [x] Draft the copy");
    expect(prompt).toContain("## Done when\n\n- Every open task above is finished.");
  });

  test("carries the note body as context without repeating its title", () => {
    const prompt = buildHandToAiPrompt({ title: "Ship the onboarding tour", body: NOTE });
    const context = prompt.slice(prompt.indexOf("## Context"));
    expect(context).toContain("<note>\nMake the first-run tour teach");
    expect(context).toContain("Notes: the tour lives in `src/components/onboarding/`.\n</note>");
    expect(context).not.toContain("# Ship the onboarding tour");
  });

  test("a note with no tasks and no prose paragraph still reads as a handoff", () => {
    const prompt = buildHandToAiPrompt({ title: "Ideas", body: "# Ideas\n\n## Later\n\n- a bullet" });
    expect(prompt).toContain("## Goal\n\nCarry out the work the note below describes.");
    expect(prompt).toContain("## Open tasks\n\nNone are written as tasks; work from the context below.");
    expect(prompt).not.toContain("## Already done");
    expect(prompt).toContain("## Done when\n\n- The goal above is met.");
  });

  test("a plain first-line title (no #) is the title, not the goal", () => {
    const prompt = buildHandToAiPrompt({
      title: "Launch checklist",
      body: "Launch checklist\n\nShip on Friday.",
    });
    expect(prompt).toContain("## Goal\n\nShip on Friday.");
    expect(prompt).toContain("<note>\nShip on Friday.\n</note>");
  });

  test("tasks inside a code fence are code, not tasks", () => {
    const body = "# Fence\n\nExplain the syntax.\n\n```md\n- [ ] not a task\n```\n";
    const prompt = buildHandToAiPrompt({ title: "Fence", body });
    expect(prompt).toContain("None are written as tasks");
    expect(prompt).toContain("- [ ] not a task\n```\n</note>");
  });
});
