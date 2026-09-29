import { describe, expect, test } from "bun:test";

import { modelErrorText } from "./modelError";

const RAW =
  "API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations. Claude Code can't respond to this message with Opus 5.5.\n\nTry rephrasing the request in a new session or change your model.\n\nLearn more: https://support.claude.com/en/articles/8106465\n\nDetails: [reasoning_extraction]\nRequest ID: req_x\nMessage ID: msg_y";

describe("modelErrorText", () => {
  test("a provider safeguard block reads as one plain sentence with its category", () => {
    expect(modelErrorText(RAW)).toBe(
      "Claude's safety filter blocked this reply (reasoning_extraction). It sometimes flags ordinary requests. Edit your message and send it again, or switch model. Rotli doesn't retry on its own, because a blocked request still counts toward your plan.",
    );
  });

  test("a block without a category still reads plainly", () => {
    expect(modelErrorText("API Error: Opus 5.5's safeguards flagged this message.")).toContain(
      "Claude's safety filter blocked this reply. It sometimes",
    );
  });

  test("every other error passes through unchanged", () => {
    expect(modelErrorText("claude isn't installed")).toBe("claude isn't installed");
  });
});
