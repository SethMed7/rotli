// Short answers to the questions a first visit raises. Every answer restates
// a claim made elsewhere on the site; nothing here may promise more. The
// landing FAQ renders these, and the same list is the page's FAQPage JSON-LD
// (src/agents.ts), so what a search engine quotes is what a visitor reads.
import { site } from './site';

export const questions: { q: string; a: string }[] = [
  {
    q: 'Is rotli free?',
    a: site.sourcePublic
      ? 'Yes. It is free, needs no account, and the source is open under the MIT license.'
      : 'Yes. It is free and needs no account.',
  },
  {
    q: 'Where do my notes live?',
    a: 'In one folder you choose, as plain Markdown files. rotli keeps its settings and search indexes in a hidden .rotli folder inside it, and can rebuild them at any time.',
  },
  {
    q: 'Does it work offline?',
    a: 'Yes. Writing, tasks, links, and search need no network. Chat works offline too when you use an on-device model.',
  },
  {
    q: 'Which AI can I use?',
    a: 'A model that runs on your Mac, or the tools you already use, like Claude Code and Codex, with Cursor for code chat. AI is optional; rotli is a complete workspace without it.',
  },
  {
    q: 'Can I leave?',
    a: 'Your notes never left. The folder opens in any Markdown editor, and deleting rotli leaves every file where it was.',
  },
  {
    q: 'What about Windows and Linux?',
    a: site.webAppEnabled
      ? 'Use Rotli Web in your browser today. Native Windows and Linux apps are planned.'
      : 'Native Windows and Linux apps are planned.',
  },
];
