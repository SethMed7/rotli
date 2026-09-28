// Talk to the Librarian, as a conversation (2026-09-28; plan:
// docs/design/librarian-bar.md). After the first ask the bar pops out into a
// small chat in the pane's corner, but the Librarian is not a chatbot: it only
// organizes (tags, marked passages, filing). Every reply can say something and
// propose actions (the same tag / mark / file grammar as the bar), and a
// request that belongs in Chat comes back flagged, so the person is offered
// "Take this to Chat". The pure half: the messages a turn sends, and a reply
// split into what is said, what is proposed, and whether it belongs in Chat.
// Nothing here calls a model or touches a file.

import type { CompleteReq } from "../ai/types";
import {
  actionsBlock,
  type Anchor,
  EXCERPT_MAX,
  type LibrarianAction,
  parseLibrarianReply,
} from "./librarianActions";

/** One turn: what the person asked (with the passage highlighted then), or
 * what the Librarian replied (its raw reply is what later turns send back). */
export type LibrarianTurn =
  | { role: "user"; text: string; highlight: Anchor | null }
  | { role: "librarian"; text: string; raw: string; actions: LibrarianAction[]; handoff?: boolean };

/** The note as it is now: read fresh for every turn, so an edit between turns
 * is what the Librarian sees. */
export interface LibrarianContext {
  title: string;
  doc: string;
  areas: readonly string[];
  tags: readonly string[];
  /** Where a note about a person goes (the Librarian rules' People groups). */
  people: readonly string[];
  /** The person's own filing rules, plain sentences. */
  filing: readonly string[];
}

const SYSTEM = `You are the Librarian of a personal notes vault. You organize the note the person has open: its tags, pointers to its passages, and where it is filed. You never rewrite notes, and you are not a general assistant: the app has a separate Chat for that.
Reply in one or two short sentences.
- When the person wants the note organized, say what you would do and end your reply with ONE JSON object in this shape, using only these actions:
{"actions":[{"type":"tag","tags":["..."]},{"type":"mark","exact":"...","label":"..."},{"type":"file","area":"..."}]}
  - "tag": short lowercase tags for the whole note.
  - "mark": point at a passage. "exact" must be words copied from the note; "label" is a short optional name.
  - "file": move the note into one of the listed areas, or, for a note about a person, one of the listed People areas.
- When you need to know which passage, which area, or who someone is, ask one short question and leave the JSON out.
- When the person asks for anything else (answering or explaining something, writing, research, a conversation), do not do it: say in one sentence that this belongs in Chat, and end with {"actions":[],"handoff":"chat"}.
Nothing changes until the person applies what you propose.`;

function noteContext(ctx: LibrarianContext): string {
  return [
    `Note title: ${ctx.title}`,
    `Current tags: ${ctx.tags.join(", ") || "(none)"}`,
    `Library areas: ${ctx.areas.join(", ") || "(none)"}`,
    `People areas: ${ctx.people.join(", ")}`,
    ...(ctx.filing.length > 0
      ? [
          "The person's own filing rules (follow them when they apply):",
          ...ctx.filing.map((rule) => `- ${rule}`),
        ]
      : []),
    "",
    "The note:",
    ctx.doc.slice(0, EXCERPT_MAX),
  ].join("\n");
}

function userContent(turn: Extract<LibrarianTurn, { role: "user" }>): string {
  return turn.highlight ? `Highlighted passage: """${turn.highlight.exact}"""\n\n${turn.text}` : turn.text;
}

/** How much of the conversation a turn carries: the Librarian's asks are short,
 * so the latest dozen turns keep the context bounded however long it runs. */
export const HISTORY_TURNS = 12;

/** Everything one turn sends: the rules and the note as it is now, then the
 * conversation so far (its latest HISTORY_TURNS), ending with the person's
 * newest message. */
export function librarianChatMessages(
  ctx: LibrarianContext,
  turns: readonly LibrarianTurn[],
): CompleteReq["messages"] {
  return [
    { role: "system", content: `${SYSTEM}\n\n${noteContext(ctx)}` },
    ...turns
      .slice(-HISTORY_TURNS)
      .map((turn) =>
        turn.role === "user"
          ? { role: "user" as const, content: userContent(turn) }
          : { role: "assistant" as const, content: turn.raw },
      ),
  ];
}

/** The passage the newest question was about, if any (a proposed mark uses it). */
export function latestHighlight(turns: readonly LibrarianTurn[]): Anchor | null {
  for (let at = turns.length - 1; at >= 0; at--) {
    const turn = turns[at];
    if (turn?.role === "user") return turn.highlight;
  }
  return null;
}

/** A reply as what is said (the JSON block and any code fence around it
 * removed), what is proposed (only what the grammar allows), and whether the
 * Librarian says the request belongs in Chat instead. */
export function splitLibrarianReply(
  reply: string,
  context: { doc: string; highlight: Anchor | null; areas: readonly string[]; people?: readonly string[] },
): { prose: string; actions: LibrarianAction[]; handoff: boolean } {
  const block = actionsBlock(reply);
  const prose = block
    ? `${reply.slice(0, block.start).replace(/```(?:json)?\s*$/i, "")}${reply.slice(block.end).replace(/^\s*```/, "")}`
    : reply;
  const actions = parseLibrarianReply(reply, context);
  return { prose: prose.trim(), actions, handoff: block?.handoff === "chat" && actions.length === 0 };
}
