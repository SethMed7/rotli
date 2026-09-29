// 2026-09-29: every agent step is a fresh, stateless model call. The attached
// image used to ride only step 1, so a model that fetched a page first had
// lost the picture by the time it answered ("I couldn't see the image").

import { describe, expect, test } from "bun:test";

import { runAgent } from "./loop";
import type { CompleteReq, Host } from "./types";

const SCREENSHOT = "data:image/png;base64,iVBORw0KGgo=";

function scriptedHost(replies: string[]): { host: Host; requests: CompleteReq[] } {
  const requests: CompleteReq[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("not part of this script");
  };
  const host: Host = {
    complete: async (req) => {
      requests.push(req);
      return replies.shift() ?? '{"final":"(done)"}';
    },
    webFetch: async () => "About: a builder who ships quiet tools.",
    webSearch: async () => [],
    searchNotes: async () => [],
    readNote: unused,
    createNote: unused,
    readFile: unused,
    generateImage: unused,
    knowledgeMap: async () => "",
  };
  return { host, requests };
}

describe("attached images", () => {
  test("ride every step of the turn, not just the first", async () => {
    const { host, requests } = scriptedHost([
      '{"tool":"web_fetch","args":{"url":"https://example.org/about"}}',
      '{"final":"a new bio, written with the screenshot in view"}',
    ]);
    let final = "";
    for await (const ev of runAgent(host, {
      history: [],
      userText: "[Image #1] review my about page and write me a new bio",
      web: true,
      model: { id: "default", api: "cli" },
      images: [SCREENSHOT],
    })) {
      if (ev.type === "final") final = ev.text;
    }
    expect(final).toBe("a new bio, written with the screenshot in view");
    expect(requests).toHaveLength(2);
    for (const req of requests) expect(req.messages[0]?.images).toEqual([SCREENSHOT]);
  });
});

// the pull-request review (2026-09-29): the step-budget wrap-up (forceFinal) rendered the raw
// history and dropped the images, so a failed ⚠ exchange came back into the
// prompt and a vision turn that ran out of steps answered blind.
describe("the forced final answer", () => {
  test("sees the same cleaned history and the turn's images", async () => {
    const { host, requests } = scriptedHost([
      '{"tool":"web_fetch","args":{"url":"https://example.org/about"}}',
      "Here is your bio.",
    ]);
    for await (const ev of runAgent(host, {
      history: [
        { role: "user", text: "first try" },
        { role: "assistant", text: "⚠ Claude's safety filter blocked this reply (reasoning_extraction)." },
      ],
      userText: "[Image #1] write me a new bio",
      web: true,
      model: { id: "default", api: "cli" },
      images: [SCREENSHOT],
      maxSteps: 1,
    })) {
      void ev;
    }
    const forced = requests.at(-1)!;
    expect(requests).toHaveLength(2);
    expect(forced.messages[0]?.content).not.toContain("safety filter blocked");
    expect(forced.messages[0]?.content).not.toContain("first try");
    expect(forced.messages[0]?.images).toEqual([SCREENSHOT]);
  });
});
