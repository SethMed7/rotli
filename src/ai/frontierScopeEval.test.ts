// Deterministic offline eval: what a frontier lane (Claude · Codex · Gemini via
// their official CLIs) is told to do for the three kinds of question a chat
// gets. Those CLIs run tool-less inside Rotli, so the rendered prompt is the
// whole of their instruction — each case renders the REAL frontier prompt for
// the question, with the globe off (the default), and checks that the rule
// governing that kind of question is present and that no rule contradicting
// it is. No model, no network.

import { describe, expect, test } from "bun:test";

import { frontierAdapter } from "./prompt";

interface EvalCase {
  name: string;
  userText: string;
  /** Instructions that must reach the model for this kind of question. */
  must: string[];
  /** Instructions that would make the model answer this question wrongly. */
  mustNot: string[];
}

const CASES: EvalCase[] = [
  {
    name: "general knowledge → answered from the model's own knowledge",
    userText: "What do you know about Grok 4.7?",
    must: [
      "answer general-knowledge questions",
      "straight from your own knowledge",
      "never refuse a general question because the web is off",
    ],
    mustNot: [
      "needs up-to-date information you can't verify",
      "search it before answering from memory",
      "don't guess",
    ],
  },
  {
    name: "about the user → the notes are searched first",
    userText: "What did I decide about the launch schedule last week?",
    must: [
      "search the notes only when the question concerns the user",
      "their past decisions or conversations",
      "for the user's own past decisions, people, or conversations, search_memory first",
    ],
    mustNot: [],
  },
  {
    name: "live data → what the model knows, qualified, and the globe mentioned once",
    userText: "What is the price of bitcoin right now?",
    must: ["as of your training", "may be out of date", "turn on the globe"],
    mustNot: ["you can't confirm it", "needs up-to-date information you can't verify"],
  },
];

describe("frontier scope eval (globe off)", () => {
  for (const c of CASES) {
    test(c.name, () => {
      const prompt = frontierAdapter.renderPrompt({
        web: false,
        knowledge: "",
        history: [],
        userText: c.userText,
        scratch: [],
        maxSteps: 6,
      });
      const lower = prompt.toLowerCase();
      // the question itself reaches the model as the newest trusted turn
      expect(prompt).toContain(`User: ${c.userText}`);
      for (const rule of c.must) expect(lower).toContain(rule.toLowerCase());
      for (const rule of c.mustNot) expect(lower).not.toContain(rule.toLowerCase());
      // the globe is offered once, never nagged, and never switched on by the model
      expect(lower.match(/globe/g)).toHaveLength(1);
      expect(prompt).not.toContain('"tool":"web_search"');
    });
  }
});
