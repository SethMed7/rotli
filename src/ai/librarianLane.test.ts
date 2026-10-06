import { expect, test } from "bun:test";

import {
  isLibrarianLane,
  LIBRARIAN_LANES,
  describeFiledBy,
  librarianCaption,
  librarianModelFor,
  librarianLaneStatus,
  librarianModelId,
  librarianSetupStep,
  suggestedLibrarian,
} from "./librarianLane";

const signedIn = { installed: true, authenticated: true, version: "1" };
const installedOnly = { installed: true, authenticated: false, version: "1" };
const notInstalled = { installed: false, authenticated: false, version: null };

test("Cursor is never a Librarian lane", () => {
  expect([...LIBRARIAN_LANES]).toEqual(["claude", "codex", "antigravity"]);
  expect(isLibrarianLane("cursor")).toBe(false);
  expect(isLibrarianLane("antigravity")).toBe(true);
});

const installedModel = { endpoint: "http://127.0.0.1:11435", registered: true };
const fallbackModel = { endpoint: "http://127.0.0.1:11435", registered: false };
const noEvidence = { detections: {}, local: [], localChecked: false };

test("each lane says how far this Mac is, never hiding one", () => {
  expect(librarianLaneStatus("local", noEvidence)).toBe("checking");
  expect(librarianLaneStatus("claude", noEvidence)).toBe("checking");
  const checked = {
    detections: { claude: signedIn, codex: installedOnly, antigravity: notInstalled },
    local: [installedModel],
    localChecked: true,
  };
  expect(librarianLaneStatus("local", checked)).toBe("ready");
  expect(librarianLaneStatus("claude", checked)).toBe("ready");
  expect(librarianLaneStatus("codex", checked)).toBe("signed-out");
  expect(librarianLaneStatus("antigravity", checked)).toBe("not-installed");
});

test("Rust's built-in fallback or a remote endpoint isn't a model on this Mac", () => {
  const evidence = (model: { endpoint: string; registered: boolean }) => ({
    detections: {},
    local: [model],
    localChecked: true,
  });
  expect(librarianLaneStatus("local", evidence(fallbackModel))).toBe("no-model");
  expect(
    librarianLaneStatus("local", evidence({ endpoint: "https://api.example.com/v1", registered: true })),
  ).toBe("no-model");
  expect(librarianLaneStatus("local", { detections: {}, local: [], localChecked: true })).toBe("no-model");
});

test("only a lane that isn't ready has a step left", () => {
  expect(librarianSetupStep("local", "ready")).toBeNull();
  expect(librarianSetupStep("claude", "checking")).toBeNull();
  expect(librarianSetupStep("local", "no-model")).toMatch(/^Add a local model in Settings → AI Models/);
  expect(librarianSetupStep("codex", "signed-out")).toMatch(/^Sign in to ChatGPT/);
  expect(librarianSetupStep("antigravity", "not-installed")).toMatch(/^Install Gemini/);
});

test("Gemini is suggested only when signed in and nothing else was chosen", () => {
  expect(suggestedLibrarian({}, "local")).toBe("local");
  expect(suggestedLibrarian({ antigravity: installedOnly }, "local")).toBe("local");
  expect(suggestedLibrarian({ antigravity: signedIn }, "local")).toBe("antigravity");
  expect(suggestedLibrarian({ antigravity: signedIn }, "claude")).toBe("claude");
});

test("an explicit pick of On this Mac is never switched to Gemini (feedback 2026-10-05)", () => {
  // the person chose before detection answered, or came Back to the screen
  expect(suggestedLibrarian({ antigravity: signedIn }, "local", { chosen: true })).toBe("local");
  expect(suggestedLibrarian({ antigravity: signedIn }, "local", { chosen: false })).toBe("antigravity");
});

test("the caption says whether notes leave the Mac", () => {
  expect(librarianCaption("local", false)).toMatch(/never enters/);
  expect(librarianCaption("antigravity", true)).toMatch(/^Gemini files your notes/);
  expect(librarianCaption("antigravity", false)).toMatch(/turned off in Connections/);
});

test("a Librarian model id sticks only inside its lane's catalog, else the chat default answers", () => {
  expect(librarianModelId("local", "opus")).toBeNull();
  // the bare alias older versions saved resolves to the entry Claude Code lists
  expect(librarianModelId("claude", "opus")).toBe("opus[1m]");
  expect(librarianModelId("claude", "sonnet")).toBe("sonnet");
  expect(librarianModelId("claude", "gemini-3.8-flash-high")).toBeNull();
  expect(librarianModelId("claude", "--help")).toBeNull();
  expect(librarianModelId("claude", 7)).toBeNull();
  expect(librarianModelFor("claude", "opus", { claude: "sonnet" })).toBe("opus[1m]");
  expect(librarianModelFor("claude", "a b", { claude: "sonnet" })).toBe("sonnet");
  expect(librarianModelFor("antigravity", null, {})).toBe("gemini-3.8-flash-high");
});

test("an id the client has not listed yet waits for its answer, then heals", () => {
  // discovery pending: a well-formed id may be one the client is about to report
  expect(librarianModelId("claude", "claude-opus-6[1m]", {})).toBe("claude-opus-6[1m]");
  const answered = {
    claude: {
      status: "ready" as const,
      at: 0,
      models: [
        {
          id: "sonnet",
          label: "Claude Sonnet 5",
          efforts: [],
          fastTier: false,
          vision: true,
          isDefault: true,
        },
      ],
    },
  };
  expect(librarianModelId("claude", "claude-opus-6[1m]", answered)).toBeNull();
  expect(librarianModelFor("claude", "claude-opus-6[1m]", { claude: "nope" }, answered)).toBe("sonnet");
});

test("a filed_by value names the lane and model for people", () => {
  expect(describeFiledBy("claude:opus")).toBe("Claude · Claude Opus 5.5 (1M context)");
  expect(describeFiledBy("antigravity:gemini-3.8-flash-high")).toBe("Gemini · Gemini 3.8 Flash (High)");
  expect(describeFiledBy("claude:unknown-id")).toBe("Claude · unknown-id");
  expect(describeFiledBy("gemma-3-12b-it-qat-4bit")).toBe("gemma-3-12b-it-qat-4bit");
});
