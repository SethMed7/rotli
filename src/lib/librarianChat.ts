// Talk to the Librarian, as a conversation (2026-09-28; plan:
// docs/design/librarian-bar.md). After the first ask the bar pops out into a
// small chat in the pane's corner, but the Librarian is not a chatbot: it only
// organizes (tags, marked passages, filing). Every reply can say something and
// propose actions (the same tag / mark / file grammar as the bar), and a
// request that belongs in Chat comes back flagged, so the person is offered
// "Take this to Chat". The person can also tell it how things are ("Kunal and
// Dhaval are work people"): then the reply carries vault actions too — rules,
// People groups, new people, and questions about people it already has
// (librarianPeople.ts). The pure half: the messages a turn sends, and a reply
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
import { parseVaultActions, type PersonNote, type VaultAction } from "./librarianPeople";
import type { LibrarianRules } from "./librarianRules";

/** One turn: what the person asked (with the passage highlighted then), or
 * what the Librarian replied (its raw reply is what later turns send back). */
export type LibrarianTurn =
  | { role: "user"; text: string; highlight: Anchor | null }
  | {
      role: "librarian";
      text: string;
      raw: string;
      actions: LibrarianAction[];
      /** What it keeps in the vault besides the note (rules, people). */
      vault?: VaultAction[];
      handoff?: boolean;
    };

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
  /** The whole rules, which a statement may add to. */
  rules: LibrarianRules;
  /** The people the vault already has notes for. */
  known: readonly PersonNote[];
}

const SYSTEM = `You are the Librarian of a personal notes vault. You organize the note the person has open (its tags, pointers to its passages, and where it is filed) and you keep their People notes and filing rules. You never rewrite notes, and you are not a general assistant: the app has a separate Chat for that.
Reply in one or two short sentences, then, when there is something to do, ONE JSON object: {"actions":[...]}. Use only these actions:
- For the open note:
  - {"type":"tag","tags":["..."]}: short lowercase tags for the whole note.
  - {"type":"mark","exact":"...","label":"..."}: point at a passage. "exact" must be words copied from the note; "label" is a short optional name.
  - {"type":"file","area":"..."}: move the note into one of the listed areas, or, for a note about a person, one of the listed People areas.
- When the person tells you about people or how they want things kept (a statement, not about the open note):
  - {"type":"person","name":"...","group":"...","about":"...","tags":["..."]}: one for each person they mention. "group" is one of the People groups; "about" is one short sentence of what they said about that person (for example "Worked at Northwind; no longer does."). For someone listed under People notes, this proposes a change they will be asked to confirm.
  - {"type":"rule","text":"..."}: a short filing rule in their words, when the statement says how something should always be kept (for example "Notes about Ana or Leo go to People/Work").
  - {"type":"group","name":"..."}: a new People group, only when none of the listed groups fits.
  Do not tag or file the open note for a statement about other people.
- Act on what is clear. When you need to know which passage, which area, or who someone is, ask one short question about just that.
- When the person asks for anything else (answering or explaining something, writing, research, a conversation), do not do it: say in one sentence that this belongs in Chat, and end with {"actions":[],"handoff":"chat"}.
New people, groups and rules are added as soon as you reply. Changes to the open note and to people who already have notes wait until the person says yes.`;

function noteContext(ctx: LibrarianContext): string {
  return [
    `Note title: ${ctx.title}`,
    `Current tags: ${ctx.tags.join(", ") || "(none)"}`,
    `Library areas: ${ctx.areas.join(", ") || "(none)"}`,
    `People areas: ${ctx.people.join(", ")}`,
    `People groups: ${ctx.rules.people.mode === "groups" ? ctx.rules.people.groups.join(", ") || "(none)" : "(one People list, no groups)"}`,
    `People notes: ${ctx.known.map((person) => `${person.title} (${person.area})`).join(", ") || "(none yet)"}`,
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
 * removed), what is proposed for the note and kept in the vault (only what the
 * grammar allows), and whether the Librarian says the request belongs in Chat
 * instead. */
export function splitLibrarianReply(
  reply: string,
  context: {
    doc: string;
    highlight: Anchor | null;
    areas: readonly string[];
    people?: readonly string[];
    rules?: LibrarianRules;
    known?: readonly PersonNote[];
  },
): { prose: string; actions: LibrarianAction[]; vault: VaultAction[]; handoff: boolean } {
  const block = actionsBlock(reply);
  const prose = block
    ? `${reply.slice(0, block.start).replace(/```(?:json)?\s*$/i, "")}${reply.slice(block.end).replace(/^\s*```/, "")}`
    : reply;
  const actions = parseLibrarianReply(reply, context);
  const vault =
    block && context.rules
      ? parseVaultActions(block.actions, { rules: context.rules, known: context.known ?? [] })
      : [];
  const handoff = block?.handoff === "chat" && actions.length === 0 && vault.length === 0;
  return { prose: prose.trim(), actions, vault, handoff };
}
