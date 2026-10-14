import { expect, test } from "bun:test";

import { aiEditHint } from "./aaPanel";

test("the AI-edits row says what each verdict means, and how a lock is undone", () => {
  expect(aiEditHint("allowed")).toContain("may rewrite this note’s text");
  expect(aiEditHint("person-written")).toContain("unless you allow it");
  expect(aiEditHint("revoked")).toContain("It can still read the note.");
  expect(aiEditHint("locked")).toContain("Unlock it from the note’s menu");
  expect(aiEditHint(null)).toContain("Whether chat and agents");
});
