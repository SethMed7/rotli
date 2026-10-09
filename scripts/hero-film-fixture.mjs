// The hero film's synthetic notes and its scripted pieces (the model behind the fake helper, the
// drawn pointer, the Librarian's fields), shared by the web take (capture-hero.mjs) and the vault the
// Mac clip is shot in (hero-librarian-vault.mjs), so the two halves of the film show the same
// notes and the same note written on camera, word for word. Synthetic people and text.

// Notes the Librarian filed earlier, by area.
export const FILED = {
  "wiki/Clients/Discount policy.md": `---
area: Clients
summary: Annual plans get 15% off; anything above that needs Jo's sign-off.
tags: [pricing, clients]
links: ["[[Jo Park]]"]
filed_by: librarian
---
# Discount policy

Annual plans: 15% off.
Anything above 15% needs Jo's sign-off.
`,
  "wiki/People/Jo Park.md": `---
area: People
tags: [team]
filed_by: librarian
---
# Jo Park

Runs pricing and discounts.
`,
  "wiki/Projects/Q4 launch plan.md": `---
area: Projects
tags: [launch]
filed_by: librarian
---
# Q4 launch plan

- [ ] Pricing deck for the review
- [ ] Partner announcement
`,
  "wiki/Research/Pricing ideas.md": `---
area: Research
tags: [pricing]
filed_by: librarian
---
# Pricing ideas

Tiered seats. Annual first.
`,
};

// —— the note written on camera, and what the Librarian adds when it files it (the Mac clip
// shows the real thing; after the cut the web vault is given this same result) ——
export const NOTE_LINES = [
  "call w/ dana re pricing",
  "she's ok w/ annual. wants the deck fri??",
  "ask jo about the discount thing",
];
export const FILED_FIELDS = `---
area: Clients
summary: Dana agrees to annual pricing and wants the deck on Friday.
tags: [pricing, annual, deck]
links: ["[[Discount policy]]", "[[Jo Park]]"]
filed_by: librarian
---
`;

/** The Librarian's fields written into a note's own frontmatter, the way it fills them: each of
 * its keys (area, summary, tags, links, filed_by) set in place where the note already has it,
 * added where it does not; Rotli's own keys and the words below stay as they were. */
export function withLibrarianFields(note) {
  const fields = FILED_FIELDS.split("\n").filter((line) => line && line !== "---");
  if (!note.startsWith("---\n")) return `${FILED_FIELDS}${note}`;
  const close = note.indexOf("\n---", 4);
  const lines = note.slice(4, close).split("\n");
  for (const field of fields) {
    const key = field.slice(0, field.indexOf(":") + 1);
    const at = lines.findIndex((line) => line.startsWith(key));
    if (at >= 0) lines[at] = field;
    else lines.push(field);
  }
  return `---\n${lines.join("\n")}${note.slice(close)}`;
}

// —— the scripted model behind the fake helper: it asks the app to search and
// read, then answers only from what those real tool results returned ——
const ANSWER = [
  "From **Call with Dana**: she's fine with annual pricing and wants the deck on Friday.",
  "",
  "Still open: ask Jo about the discount. **Discount policy** says annual is 15% off,",
  "and anything above that needs Jo's sign-off.",
].join("\n");
export function scriptedModel(prompt) {
  if (prompt.startsWith("System: You name conversations")) return "Dana follow-up";
  if (prompt.startsWith("You maintain the running notes"))
    return "- Dana: annual pricing, deck Friday; ask Jo about the discount";
  if (!prompt.includes("STEP 1 ACTION"))
    return JSON.stringify({ tool: "search_notes", args: { query: "Dana pricing" } });
  if (!prompt.includes("STEP 2 ACTION")) {
    const hits = JSON.parse(prompt.match(/STEP 1 RESULT[^\n]*\n<result>\n(.*)\n<\/result>/)[1]);
    const call = hits.find((hit) => hit.title.startsWith("call w/ dana"));
    if (!call) throw new Error("search did not return the note written on camera");
    return JSON.stringify({ tool: "read_note", args: { id: call.id } });
  }
  if (!prompt.includes("STEP 3 ACTION"))
    return JSON.stringify({ tool: "read_note", args: { id: "wiki/Clients/Discount policy.md" } });
  return JSON.stringify({ final: ANSWER });
}

// The pointer the film shows (Playwright's own is invisible in captures): an
// arrow that follows real mouse events, plus a ring on each press.
export const POINTER = `(() => {
  const mount = () => {
    const style = document.createElement("style");
    style.textContent = \`
      #hero-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
        width: 24px; height: 24px; transform: translate(-100px, -100px); transition: opacity 200ms; }
      .hero-press { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px;
        margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid #c97e62;
        animation: hero-press 420ms ease-out forwards; }
      @keyframes hero-press { from { transform: scale(0.4); opacity: 0.9; } to { transform: scale(1.2); opacity: 0; } }\`;
    const pointer = document.createElement("div");
    pointer.id = "hero-pointer";
    pointer.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 3l13.5 10.2-6 .9 3.6 6.7-2.6 1.4-3.6-6.8L5 19.6z" fill="#3a3028" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.append(style, pointer);
    addEventListener("mousemove", (e) => { pointer.style.transform = \`translate(\${e.clientX - 5}px, \${e.clientY - 3}px)\`; }, true);
    addEventListener("mousedown", (e) => {
      const ring = document.createElement("div");
      ring.className = "hero-press";
      ring.style.left = e.clientX + "px";
      ring.style.top = e.clientY + "px";
      document.documentElement.append(ring);
      setTimeout(() => ring.remove(), 500);
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount); else mount();
})();`;
