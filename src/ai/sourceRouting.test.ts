import { describe, expect, test } from "bun:test";

import { localSourceRoute } from "./sourceRouting";

describe("localSourceRoute", () => {
  test("recognizes paraphrased public fact questions without relying on entity names", () => {
    const external = [
      "Name the researchers reported as signers of the public frontier-AI slowdown letter.",
      "Give the launch moment in Pacific and Eastern time.",
      "Report its mass and the capacity you can actually use, not nominal capacity.",
      "How did Kestrel get into space?",
      "What was the phase-two primary-outcome result and regulatory standing?",
      "Identify the purchaser and consideration for the software deal.",
      "Using the standardized runtimes, which model wins?",
      "Summarize the newly announced event.",
      "What launch date can be stated confidently?",
      "Give me the verified mission launch date.",
    ];
    for (const question of external) expect(localSourceRoute(question)).toBe("external");
  });

  test("personal anchors win even when the subject also has an external cue", () => {
    expect(localSourceRoute("What did we decide about the launch schedule?")).toBe("personal");
    expect(localSourceRoute("What is the usable capacity listed in my notes?")).toBe("personal");
    expect(localSourceRoute("Summarize this launch report", true)).toBe("personal");
  });

  test("leaves an unanchored name ambiguous instead of sending it off-device", () => {
    expect(localSourceRoute("Who is Morgan?")).toBe("ambiguous");
    expect(localSourceRoute("Tell me about Northstar.")).toBe("ambiguous");
  });
});
