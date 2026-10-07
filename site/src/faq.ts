// Short answers to the questions a first visit raises. Every answer restates
// a claim made elsewhere on the site; nothing here may promise more. The
// landing FAQ renders these, and the same list is the page's FAQPage JSON-LD
// (src/agents.ts), so what a search engine quotes is what a visitor reads.
// An answer stays plain text; where a visitor needs to go further, `links`
// follow it on the page as a separate line (never part of the JSON-LD text).
import { DOCS_AND_SHEETS, site } from "./site";

export const questions: { q: string; a: string; links?: { href: string; label: string }[] }[] = [
  {
    q: "Is rotli free?",
    a: site.sourcePublic
      ? "Yes. It is free, needs no account, and the source is open under the MIT license."
      : "Yes. It is free and needs no account.",
  },
  {
    q: "Where do my notes live?",
    a: "In one folder you choose, as plain Markdown files. rotli keeps its settings and search indexes in a hidden .rotli folder inside it, and can rebuild them at any time.",
  },
  // Where the landing's story used to end on a "Getting started with your vault" link (removed
  // 2026-10-07, the owner: a FAQ answer plus the guide instead). The facts are the guide's
  // (content/writing/posts/getting-started.md, "Pick a folder" and "Try the Welcome folder").
  {
    q: "What is a vault, and how do I start one?",
    a: "Your vault is the folder your notes live in. Pick an empty folder to start fresh, or one that already holds Markdown notes. A new vault opens with a short Welcome folder you can edit or delete.",
    links: [{ href: "/blog/getting-started/", label: "Getting started" }],
  },
  {
    q: "Does it work offline?",
    a: "Yes. Writing, tasks, links, and search need no network. Chat works offline too when you use an on-device model.",
  },
  {
    q: "Which AI can I use?",
    a: "A model that runs on your Mac, or the tools you already use, like Claude Code and Codex, with Cursor for code chat. AI is optional; rotli is a complete workspace without it.",
  },
  {
    q: "Do I have to pay for AI?",
    a: "No. rotli has no AI plan of its own and charges nothing for AI. It uses a model that runs on your Mac, or the AI tools you already pay for. Without AI it is still a complete workspace.",
  },
  {
    q: "Is rotli just a notes app?",
    a: `Notes are the foundation, as plain Markdown files. Around them, chat answers from your own notes, the Librarian files and links them, and Docs and Sheets (${DOCS_AND_SHEETS.inline}) and boards live as ordinary files in the same folder. The Features page says which parts run on the Mac and which in the browser.`,
  },
  {
    q: "Can I leave?",
    a: "Your notes never left. The folder opens in any Markdown editor, and deleting rotli leaves every file where it was.",
  },
  // Rotli Web and the Helper, in brief (the tour's last part said this until it was removed,
  // 2026-10-06). The facts are content/writing/posts/rotli-helper.md's and PLATFORMS'.
  ...(site.webAppEnabled
    ? [
        {
          q: "Can I use rotli in my browser?",
          a: "Yes. Rotli Web is the same editor in your browser, and your notes stay in a folder on your computer. Chrome, Edge, and Arc open that folder directly. Firefox, Zen, and Brave, and chat in any browser, need Rotli Helper, a small program on your computer. Safari and phones aren’t supported yet.",
          links: [
            { href: "/blog/rotli-helper/", label: "What is Rotli Helper?" },
            { href: "/blog/rotli-web-and-your-mac/", label: "Why it goes through Terminal" },
          ],
        },
      ]
    : []),
  {
    q: "What about Windows and Linux?",
    a: site.webAppEnabled
      ? "Native Windows and Linux apps are coming soon. Until then, use Rotli Web: it runs in your browser today."
      : "Native Windows and Linux apps are coming soon.",
  },
];
