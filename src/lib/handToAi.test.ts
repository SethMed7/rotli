import { describe, expect, test } from "bun:test";

import { type AttachmentPlace, attachmentLinks, buildHandToAiPrompt } from "./handToAi";

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

  test("only the first line can be the title: a # comment in a code block stays", () => {
    const body = "Deploy\n\nRun the script.\n\n```sh\n# build first\nbun run build\n```\n";
    const prompt = buildHandToAiPrompt({ title: "Deploy", body });
    expect(prompt).toContain("## Goal\n\nRun the script.");
    expect(prompt).toContain("```sh\n# build first\nbun run build");
    expect(prompt).not.toContain("<note>\nDeploy");
  });
});

describe("Hand to AI attachments", () => {
  const BODY = [
    "# Fix the login page",
    "",
    "The button overlaps the field, see ![Login screen|420](storage:login.png).",
    "",
    "- [ ] Match the spec in [the spec](storage:spec.pdf)",
    "",
    "![](<storage:old shot.png>)",
    "",
    "Background: [design notes](wiki/design.md), [site](https://example.com), [top](#top).",
    "",
    "```md",
    "![not a link](storage:fenced.png)",
    "```",
  ].join("\n");
  const PLACES = new Map<string, AttachmentPlace>([
    ["storage:login.png", { status: "found", rel: "storage/login.png", path: "/Vault/storage/login.png" }],
    [
      "storage:spec.pdf",
      { status: "found", rel: "storage/spec.pdf", path: "/Vault/storage/My Specs/spec.pdf" },
    ],
    ["storage:old shot.png", { status: "missing", rel: "storage/old shot.png" }],
  ]);

  test("finds vault file links outside fences, never notes, URLs, or anchors", () => {
    expect(attachmentLinks(BODY)).toEqual([
      { src: "storage:login.png", caption: "Login screen", image: true },
      { src: "storage:spec.pdf", caption: "the spec", image: false },
      { src: "storage:old shot.png", caption: "", image: true },
    ]);
  });

  test("a vault-relative path is a file too, and each file is listed once", () => {
    expect(attachmentLinks("[data](exports/q3.csv) then [again](exports/q3.csv)")).toEqual([
      { src: "exports/q3.csv", caption: "data", image: false },
    ]);
  });

  test("a bare destination with spaces or a title reads as the editor reads it", () => {
    expect(attachmentLinks('![w2](Secure notes/w2.png) [a](storage:a.png "Plan")')).toEqual([
      { src: "Secure notes/w2.png", caption: "w2", image: true },
      { src: "storage:a.png", caption: "a", image: false },
    ]);
  });

  test("lists every file with its absolute path, and a missing one as missing", () => {
    const prompt = buildHandToAiPrompt({ title: "Fix the login page", body: BODY, attachments: PLACES });
    expect(prompt).toContain(
      [
        "## Attachments",
        "",
        "The note links to these files. Open them at these paths.",
        "",
        "- /Vault/storage/login.png (image, “Login screen”)",
        "- /Vault/storage/My Specs/spec.pdf (file, “the spec”)",
        "- storage/old shot.png (image): missing, not found in the vault",
      ].join("\n"),
    );
    // after the tasks, before the note itself
    expect(prompt.indexOf("## Attachments")).toBeGreaterThan(prompt.indexOf("## Open tasks"));
    expect(prompt.indexOf("## Attachments")).toBeLessThan(prompt.indexOf("## Context"));
  });

  test("the note's links point at those paths; the editor's |width is gone", () => {
    const prompt = buildHandToAiPrompt({ title: "Fix the login page", body: BODY, attachments: PLACES });
    expect(prompt).toContain("see ![Login screen](/Vault/storage/login.png).");
    expect(prompt).toContain("- [ ] Match the spec in [the spec](</Vault/storage/My Specs/spec.pdf>)");
    expect(prompt).toContain("[missing file: storage/old shot.png]");
    expect(prompt).not.toContain("storage:login.png");
    expect(prompt).not.toContain("|420");
    // code stays exactly as written, and links that aren't files are untouched
    expect(prompt).toContain("![not a link](storage:fenced.png)");
    expect(prompt).toContain("[design notes](wiki/design.md), [site](https://example.com)");
  });

  test("without file paths (Rotli Web) the vault-relative path is what's given", () => {
    const places = new Map<string, AttachmentPlace>([
      ["storage:login.png", { status: "found", rel: "storage/login.png", path: null }],
    ]);
    const prompt = buildHandToAiPrompt({
      title: "Fix",
      body: "![shot](storage:login.png)",
      attachments: places,
    });
    expect(prompt).toContain("Paths are relative to my notes folder.\n\n- storage/login.png (image, “shot”)");
    expect(prompt).toContain("![shot](storage/login.png)");
  });

  test("a note with no files has no Attachments section", () => {
    expect(buildHandToAiPrompt({ title: "Plain", body: "Do the thing." })).not.toContain("## Attachments");
  });
});
