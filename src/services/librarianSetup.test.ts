import { expect, test } from "bun:test";

import { librarianSetupStepNow } from "./librarianSetup";

const checked = { detections: {}, local: [], localChecked: true };
const notInstalled = { installed: false, authenticated: false, version: null };

test("on the Mac, a Librarian on with no local model has a step left", () => {
  expect(librarianSetupStepNow({ on: true, native: true, lane: "local", evidence: checked })).toMatch(
    /^Add a local model in Settings → AI Models/,
  );
  expect(
    librarianSetupStepNow({
      on: true,
      native: true,
      lane: "claude",
      evidence: { ...checked, detections: { claude: notInstalled } },
    }),
  ).toMatch(/^Install Claude/);
});

test("nothing is owed while it's checking, when it's off, or on the web", () => {
  const unchecked = { detections: {}, local: [], localChecked: false };
  expect(librarianSetupStepNow({ on: true, native: true, lane: "local", evidence: unchecked })).toBeNull();
  expect(librarianSetupStepNow({ on: true, native: true, lane: "claude", evidence: checked })).toBeNull();
  expect(librarianSetupStepNow({ on: false, native: true, lane: "local", evidence: checked })).toBeNull();
  expect(librarianSetupStepNow({ on: true, native: false, lane: "local", evidence: checked })).toBeNull();
});
