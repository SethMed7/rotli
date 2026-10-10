// The feature catalog: the one list of what rotli does, behind /features/, each
// /features/<id>/ page, the catalog's Markdown twin, and the Features lines in
// /llms.txt (src/agents.ts). Pure data with no Astro or image imports, so the
// root tests can read it (scripts/site-features.test.ts).
//
// Honesty rules, held by that test:
// - A "Shipped" entry cites its basis: a quote from README.md (what is
//   released, ROADMAP.md says) or from a released section of CHANGELOG.md,
//   never [Unreleased]. The test finds every quote, whitespace aside. An entry
//   that took in others (its `sections`) carries every one of their quotes.
// - Docs and Sheets take their status from DOCS_AND_SHEETS (src/site.ts), the
//   owner's call, even though ROADMAP.md still lists them under "In the work".
// - Anything else not shipped names its ROADMAP.md "In the work" id. "Coming
//   soon" is the next release's (/chart, /ai, chat attachments); "In
//   development" lives in development builds and shows only on the dev site
//   (`site.showsExperiments`; site/README.md: features under review appear only
//   there). The public catalog points to /roadmap/ for the rest.
// - `runs` says where a feature works today. "both" only where a source says
//   Rotli Web has it: the editor, notes, views, and settings (1.1.0 "Rotli Web
//   (first phase)"), chat through Rotli Helper (1.1.0), Tasks (1.2.0),
//   Templates (1.3.0), boards (1.4.0), and search (1.6.0). The same 1.1.0 entry
//   keeps the Librarian, the model lanes, Word files, and sheets in the Mac app.
//   An entry that is "both" names its Mac-only parts in `limits`. Rotli Web is
//   only named while WEB_APP_ENABLED; otherwise everything reads "Mac", which
//   is true of all of it. Windows and Linux are never claimed: no rotli app
//   runs there yet (PLATFORMS in src/site.ts).
// - Docs and Sheets say no more than that they open and edit (site/README.md).
//
// The catalog was condensed on 2026-10-06 (the owner: "condense the list, I feel some things
// can be combined"): related capabilities became one entry, and each one taken in became a
// section of the surviving page, its old id the section's anchor. `movedFeatures()` turns those
// sections into redirects, so every old /features/<id>/ address lands on its section.
import { DOCS_AND_SHEETS, PLATFORMS, WEB_APP_PATH, site } from './site';

export type Status = 'Shipped' | 'Beta' | 'In development' | 'Coming soon';
export type AreaId = 'writing' | 'organizing' | 'ai' | 'files' | 'privacy' | 'web';
/** A quokka pose in src/assets/characters/filled/cocoa/ (see src/og.ts POSES). */
export type Pose =
  | 'notes'
  | 'knowledge_system'
  | 'ai_chat'
  | 'excalidraw_board'
  | 'stays_local'
  | 'searching';

export interface Area {
  id: AreaId;
  name: string;
  line: string;
  pose: Pose;
}

export const AREAS: Area[] = [
  {
    id: 'writing',
    name: 'Writing',
    line: 'A calm Markdown editor where tasks, links, and diagrams draw themselves.',
    pose: 'notes',
  },
  {
    id: 'organizing',
    name: 'Organizing',
    line: 'The Librarian files, views arrange, and every file stays where it is.',
    pose: 'knowledge_system',
  },
  {
    id: 'ai',
    name: 'AI and chat',
    line: 'Ask your notes, with a model on your Mac or the AI tools you already use.',
    pose: 'ai_chat',
  },
  {
    id: 'files',
    name: 'Files',
    line: 'Docs, Sheets, boards, and pictures beside your notes, as ordinary files.',
    pose: 'excalidraw_board',
  },
  {
    id: 'privacy',
    name: 'Privacy and control',
    line: 'One folder you own, and your rules for what AI may see and change.',
    pose: 'stays_local',
  },
  {
    id: 'web',
    name: 'Rotli Web and agents',
    line: 'The same notes in a browser, and a command line for scripts.',
    pose: 'searching',
  },
];

/** Where a claim comes from: a file and a quote the test finds in it. */
export interface Basis {
  file: 'README.md' | 'CHANGELOG.md';
  quote: string;
}

/** A detail page's picture: a real capture from public/, or a drawing (FeatureArt.astro). */
export type Picture =
  | { kind: 'shot'; src: string; width: number; height: number; alt: string }
  | { kind: 'tasks' | 'links' | 'filing' | 'menu' | 'tree' | 'doc' | 'sheet' | 'terminal' | 'graph' };

export interface Step {
  /** Keys, a command, or a path through the app, shown as written. */
  keys: string;
  text: string;
}

export interface Link {
  href: string;
  label: string;
}

/**
 * A part of a feature's page that was once its own entry: its old id is the section's anchor,
 * and its old address redirects there (`movedFeatures`).
 */
export interface Section {
  id: string;
  title: string;
  body: string[];
  picture?: Picture;
  use?: Step[];
}

export interface Feature {
  id: string;
  area: AreaId;
  name: string;
  /** One sentence for the tile, the page's lede, and llms.txt. */
  line: string;
  status: Status;
  runs: 'mac' | 'both' | 'web';
  /** A 24×24 stroke icon (one path). */
  icon: string;
  /** A capture or a drawing for the feature's page; without one the page leads with its words. */
  picture?: Picture;
  /** What it does, a paragraph each. */
  body: string[];
  use: Step[];
  /** The capabilities this entry took in, each a section of its page. */
  sections?: Section[];
  /** Old ids whose words now lead this page (not a section): their addresses redirect to its top. */
  formerly?: string[];
  limits: string[];
  links: Link[];
  /** Required for Shipped. */
  basis?: Basis[];
  /** Required for everything not shipped: the ROADMAP.md item, or items. */
  roadmap?: string | string[];
  /** A shipped feature whose next step is a ROADMAP.md "In the work" item. */
  next?: string;
  /** Shown only while Rotli Web is offered (WEB_APP_ENABLED). */
  needsWebApp?: true;
  /** Words the search box also matches. */
  keywords?: string;
}

const ROADMAP = { href: '/roadmap/', label: 'The roadmap' };
const GETTING_STARTED = { href: '/blog/getting-started/', label: 'Getting started' };
const AI_GUIDE = { href: '/blog/ai-and-your-notes/', label: 'AI and your notes' };
const WHY_LOCAL = { href: '/blog/why-local/', label: 'Why local' };
const HELPER_GUIDE = { href: '/blog/rotli-helper/', label: 'The Rotli Helper guide' };
const WEB_AND_MAC = { href: '/blog/web-and-mac/', label: 'Rotli Web and the Mac app' };
const PRIVACY = { href: '/privacy/', label: 'Privacy, in full' };
const DEVELOPERS = { href: '/resources/developers/', label: 'Developers' };

const ICON = {
  note: 'M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M9 12h6M9 15.5h6M9 9h2',
  tasks: 'M4 6.5l1.6 1.6L8.5 5M11 7h9M4 12.5h4v4H4zM11 14.5h9M11 19h6',
  diagram: 'M3.5 4.5h6v4h-6zM14.5 15.5h6v4h-6zM6.5 8.5v4.5h11v2.5',
  template: 'M5 3.5h14v17H5zM8.5 7.5h7M8.5 11h7M8.5 14.5h4',
  search: 'M10.5 4a6.5 6.5 0 1 0 0.01 0M15.2 15.2L20 20',
  capture: 'M12 4.5v15M4.5 12h15',
  librarian: 'M3.5 6.5h6l2 2h9v11h-17zM9 14l2.2 2.2L15.5 12',
  views: 'M4 5.5h7v13H4zM13 5.5h7v6h-7zM13 13.5h7v5h-7z',
  graph: 'M6 4.5a2 2 0 1 0 0.01 0M18 7a2 2 0 1 0 0.01 0M10 16.5a2 2 0 1 0 0.01 0M7.9 6.9l8.2 0.6M6.8 8.4l2.4 6.3M16.7 8.6l-5.3 6.4',
  chat: 'M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z',
  terminal: 'M3.5 5h17v14h-17zM7 9.5l3 2.5-3 2.5M12.5 15h4.5',
  handoff: 'M4.5 12h11M12 7.5l4.5 4.5-4.5 4.5M19.5 5v14',
  chart: 'M4.5 4.5v15h15M8.5 15v-3M12.5 15V8.5M16.5 15v-5.5',
  sparkle: 'M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z',
  clip: 'M16.5 8.5l-6.8 6.8a2 2 0 0 1-2.8-2.8l7.4-7.4a3.5 3.5 0 0 1 5 5L12 17.4',
  doc: 'M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M9 12.5h6M9 16h6',
  board: 'M3.5 6.5h7v6h-7zM15.5 13.5a3.5 3.5 0 1 0 0.01 0M10.5 9.5h3.5l2 2.5',
  folder: 'M3.5 6.5h6l2 2h9v11h-17z',
  shield: 'M12 3.5l7 2.5v5.5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6l7-2.5z',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0.01 0M3.5 12h17M12 3.5c-2.6 2.8-2.6 14.2 0 17M12 3.5c2.6 2.8 2.6 14.2 0 17',
  plug: 'M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5',
  agent: 'M6.5 7.5h11v10h-11zM12 4v3.5M9.5 12h0.01M14.5 12h0.01M3.5 11v3M20.5 11v3',
  speaker: 'M4.5 9.5h3.5l4.5-4v13l-4.5-4H4.5zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  brief: 'M4.5 5.5h15v13h-15zM4.5 9.5h15M8 13h8M8 16h5',
  sun: 'M12 8a4 4 0 1 0 0.01 0M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
} as const;

const FEATURES: Feature[] = [
  // ─── Writing ──────────────────────────────────────────────────────────
  {
    id: 'markdown',
    area: 'writing',
    name: 'Markdown that renders as you type',
    line: 'Headings, tasks, tables, code, math, and diagrams draw themselves, and the Markdown shows only on the line you are editing.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.note,
    picture: {
      kind: 'shot',
      src: '/shots/render-note.webp',
      width: 1512,
      height: 1226,
      alt: 'A note called Launch week with tasks in three states, result buttons, a switch, a single choice, and a checklist panel',
    },
    body: [
      'Write ordinary Markdown and rotli draws it as you go: headings, lists, checkboxes, choices, switches, tables, and links. Put the caret on a line and its Markdown comes back, so you can always see what you typed.',
      'What is saved is plain text. Open the same file in any other editor and it reads the same.',
    ],
    use: [
      { keys: 'Aa → Raw markdown', text: 'See the whole note as the text underneath.' },
      { keys: '⌘⇧A', text: 'Open the Aa panel: text size, line length, and view.' },
    ],
    sections: [
      {
        id: 'tables-code-math',
        title: 'Tables, code, and math',
        picture: {
          kind: 'shot',
          src: '/shots/render-tables.webp',
          width: 1510,
          height: 1002,
          alt: 'A three-column table, a TypeScript code block, and a rendered E = mc² equation',
        },
        body: [
          'Markdown tables render as tables you edit in place, cell by cell. Code blocks keep their text exactly, and a math block renders its equation.',
        ],
        use: [
          { keys: '/table', text: 'Start a table.' },
          { keys: '```math', text: 'Write an equation.' },
        ],
      },
      {
        id: 'diagrams',
        title: 'Mermaid diagrams',
        picture: {
          kind: 'shot',
          src: '/shots/render-mermaid.webp',
          width: 1505,
          height: 399,
          alt: 'A flowchart from Capture to Note to Library rendered inside a note',
        },
        body: [
          'Flowcharts, sequences, and pie and bar charts written in Mermaid render inside the note, with the code one click away. The source stays in the file as an ordinary code block.',
        ],
        use: [{ keys: '```mermaid', text: 'Start a diagram; close the fence and it draws.' }],
      },
    ],
    limits: [
      'Another editor shows the plain Markdown, not rotli’s drawing of it.',
      'Diagrams are edited as code. A visual editor for them is being built.',
    ],
    links: [GETTING_STARTED, ROADMAP],
    next: 'mermaid-visual',
    basis: [
      { file: 'README.md', quote: 'Hybrid Markdown shows raw syntax only on the line you are editing.' },
      { file: 'CHANGELOG.md', quote: '⌘⇧A opens the Aa panel' },
      { file: 'README.md', quote: 'Lists, checkboxes, choices, switches, tables, wikilinks' },
      { file: 'CHANGELOG.md', quote: 'joining the existing math/mermaid/jsxgraph block renderers' },
      { file: 'CHANGELOG.md', quote: 'Type `/attach`, `/table`' },
      { file: 'README.md', quote: 'Mermaid diagrams render in place.' },
    ],
    keywords: 'editor wysiwyg live preview raw table code block katex latex equation mermaid flowchart chart graph',
  },
  {
    id: 'tasks',
    area: 'writing',
    name: 'Tasks that stay text',
    line: 'Checkboxes with an in-progress state, and one Tasks page that gathers every open task.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.tasks,
    picture: { kind: 'tasks' },
    body: [
      'A task is a Markdown checkbox. Write [/] for work you have started, and the box draws half filled, so started work stops looking like work you have not touched.',
      'The Tasks page lists every open task, grouped by the note it lives in. Click one to land on it in its note. Tasks in notes you have not touched for 30 days rest in an archived group.',
    ],
    use: [
      { keys: '- [ ]', text: 'A task.' },
      { keys: '- [/]', text: 'In progress.' },
      { keys: '- [x]', text: 'Done.' },
    ],
    limits: ['Due dates and a board of task columns are ideas on the roadmap, not built.'],
    links: [ROADMAP],
    basis: [
      { file: 'CHANGELOG.md', quote: 'A task can be in progress, not just done or not.' },
      { file: 'CHANGELOG.md', quote: 'Tasks works in Rotli Web.' },
      { file: 'CHANGELOG.md', quote: 'Click a task to land on it.' },
      { file: 'CHANGELOG.md', quote: "Tasks in notes you haven't touched for 30 days rest in a" },
    ],
    keywords: 'todo checklist checkbox',
  },
  {
    id: 'search',
    area: 'writing',
    name: 'Search and links',
    line: '⌘K finds every note, file, chat, and action; [[ links one note to another, and can make the note in the same step.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.search,
    body: [
      '⌘K searches titles and text across the whole vault, and the app’s own commands too, so the same box opens a note or runs an action.',
    ],
    use: [
      { keys: '⌘K', text: 'Search and run commands.' },
      { keys: '⌘T', text: 'Start a note.' },
    ],
    sections: [
      {
        id: 'links',
        title: 'Links between notes',
        picture: { kind: 'links' },
        body: [
          'Typing [[ lists matching notes, titles first. Rest the pointer on a link to see the top of the note it points to. Choose Create in the link list to make a note that does not exist yet and link it at once.',
          'A link to a note that does not exist looks inert, never live.',
        ],
        use: [
          { keys: '[[', text: 'Link a note.' },
          { keys: 'Link note → Create', text: 'Make the note and link it.' },
        ],
      },
    ],
    limits: [
      'Renaming a note does not yet update the links that point to it; they keep working through the old name saved with the note.',
    ],
    links: [ROADMAP],
    basis: [
      { file: 'README.md', quote: 'finds every note, file, chat, and action.' },
      { file: 'CHANGELOG.md', quote: 'Wikilinks: typing `[[` opens a list of matching notes' },
      { file: 'CHANGELOG.md', quote: 'Hover a `[[link]]` to see the top of that note.' },
      { file: 'CHANGELOG.md', quote: 'Link note can make the note.' },
    ],
    keywords: 'command palette find wikilink backlink',
  },
  {
    id: 'templates',
    area: 'writing',
    name: 'Slash commands and templates',
    line: 'Type / for today’s date, a table, or a link, or drop in a template you keep as an ordinary note.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.template,
    body: [
      'A template is an ordinary note in a folder named Templates. Pick one with /template and its content lands where you were typing; in an empty note its heading becomes the title.',
      'A few built-in starters (meeting notes, a daily note, a project brief, a bug report, a weekly review) come after your own. They are never saved into your vault, and you can turn them off.',
    ],
    use: [
      { keys: '/template', text: 'Choose a template.' },
      { keys: 'Create new', text: 'Make a template from the picker.' },
    ],
    sections: [
      {
        id: 'slash-commands',
        title: 'Slash commands',
        body: [
          'A slash opens a short menu of what you can drop in where you are typing. It works inside a list item, after your text, and leaves ordinary slashes in your writing alone.',
          'The date commands write the date into the note. In a template they leave a placeholder, so a daily template shows the day you use it.',
        ],
        use: [
          { keys: '/today', text: 'Today’s date. /yesterday and /tomorrow too.' },
          { keys: '/table', text: 'A table.' },
        ],
      },
    ],
    limits: ['The Librarian leaves the Templates folder alone.', '/librarian is in the Mac app only.'],
    links: [],
    basis: [
      { file: 'CHANGELOG.md', quote: 'Keep your reusable layouts as ordinary notes in a folder named' },
      { file: 'CHANGELOG.md', quote: 'Dates from the slash menu.' },
      { file: 'CHANGELOG.md', quote: 'Slash commands work inside a list item, after your text.' },
    ],
    keywords: 'slash menu date today',
  },
  {
    id: 'quick-capture',
    area: 'writing',
    name: 'Quick capture',
    line: 'Press ⌥C anywhere on your Mac; the thought lands in Captures and is filed later.',
    status: 'Shipped',
    runs: 'mac',
    icon: ICON.capture,
    body: [
      'Capture a thought without leaving what you are doing. It lands in Captures, and the Librarian files it later if you have turned it on.',
      '⌥Space brings rotli up from anywhere and hides it again. ⌥Q opens only the Quick Note, a small window for one note.',
    ],
    use: [
      { keys: '⌥C', text: 'Capture from anywhere.' },
      { keys: '⌥Space', text: 'Show or hide rotli.' },
      { keys: '⌥Q', text: 'Open the Quick Note.' },
    ],
    limits: ['Mac app. Every one of these keys can be changed.'],
    links: [],
    basis: [
      { file: 'README.md', quote: 'with `⌥C` from anywhere; the thought lands in Captures' },
      { file: 'README.md', quote: 'Press `⌥Space` and it is there' },
      { file: 'CHANGELOG.md', quote: '⌥Q opens only the Quick Note.' },
    ],
    keywords: 'hotkey inbox quick note',
  },
  {
    id: 'make-it-yours',
    area: 'writing',
    name: 'Make it yours',
    line: 'Seven theme families in light and dark, panes and tabs side by side, and every hotkey yours to change.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.sun,
    picture: {
      kind: 'shot',
      src: '/themes/rotli-warm-light@2x.webp',
      width: 2376,
      height: 1485,
      alt: 'rotli in Rotli Light, with a note open beside the sidebar',
    },
    body: [
      'Rotli, Paper & Charcoal, Ocean, Grove, Iris, Blossom, and Midnight: every family has a light and a dark environment, each tuned on its own. The sun in the titlebar flips between them.',
    ],
    use: [{ keys: 'Settings → Appearance', text: 'Choose a family, or what the sun does.' }],
    formerly: ['themes'],
    sections: [
      {
        id: 'panes-and-keys',
        title: 'Panes, tabs, and your own keys',
        body: [
          'Open notes side by side in panes, each with its own tabs. Every hotkey can be changed in Settings → Keybindings.',
        ],
        use: [
          { keys: '⌘D', text: 'Split side by side.' },
          { keys: '⌘⇧D', text: 'Split top and bottom.' },
          { keys: '⌘N', text: 'Choose what a new tab becomes.' },
        ],
      },
    ],
    limits: ['Panes and your own keys are in the Mac app.'],
    links: [{ href: '/#personal', label: 'Try the themes on the home page' }],
    basis: [
      { file: 'CHANGELOG.md', quote: 'Blossom, a seventh theme family.' },
      { file: 'README.md', quote: 'The titlebar sun switches between paired light and dark environments' },
      { file: 'README.md', quote: 'split with `⌘D` and `⌘⇧D`; every hotkey can be rebound.' },
      { file: 'README.md', quote: '`⌘N` chooses what a new tab becomes' },
    ],
    keywords: 'themes dark mode appearance colour color split panes tabs keyboard shortcuts keybindings',
  },
  {
    id: 'charts',
    area: 'writing',
    name: 'Charts from your notes',
    line: 'Type /chart and get a chart drawn from plain-text data in the note.',
    status: 'Coming soon',
    runs: 'mac',
    icon: ICON.chart,
    body: ['The data stays readable Markdown in the note; the chart is drawn from it.'],
    use: [{ keys: '/chart', text: 'Start a chart.' }],
    limits: ['Not in a release yet.'],
    links: [ROADMAP],
    roadmap: 'charts',
  },
  {
    id: 'mermaid-visual',
    area: 'writing',
    name: 'Draw Mermaid diagrams by hand',
    line: 'Edit a Mermaid diagram on a canvas instead of only in code.',
    status: 'In development',
    runs: 'mac',
    icon: ICON.diagram,
    body: ['Viewing and editing diagrams as code already ships; this adds a canvas.'],
    use: [],
    limits: ['Development builds only.'],
    links: [ROADMAP],
    roadmap: 'mermaid-visual',
  },
  {
    id: 'read-aloud',
    area: 'writing',
    name: 'Read aloud',
    line: 'Select text and have it read to you, on your Mac.',
    status: 'In development',
    runs: 'mac',
    icon: ICON.speaker,
    body: ['The voice runs on your Mac, with nothing sent anywhere.'],
    use: [],
    limits: ['Development builds only.'],
    links: [ROADMAP],
    roadmap: 'read-aloud',
  },

  // ─── Organizing ───────────────────────────────────────────────────────
  {
    id: 'librarian',
    area: 'organizing',
    name: 'The Librarian',
    line: 'Files new notes into your Library with tags, a summary, and links, takes requests from inside a note, and never changes your words.',
    status: 'Shipped',
    runs: 'mac',
    icon: ICON.librarian,
    picture: { kind: 'filing' },
    body: [
      'Turn it on and the Librarian files each new note into an area of your Library (People, Projects, Research, and the like), adds a summary and tags, and links it to related notes. Everything it does is recorded, with an undo.',
      'It changes where a note lives and the metadata around it, never the words you wrote. It uses the model on your Mac by default, or a connected AI tool if you choose one.',
    ],
    use: [
      { keys: 'Settings → Librarian', text: 'Turn it on, choose its model, and give it your own rules.' },
      { keys: 'Librarian Activity', text: 'See what it did, and undo it.' },
    ],
    sections: [
      {
        id: 'ask-the-librarian',
        title: 'Talk to the Librarian',
        body: [
          'Type /librarian in a note and the format bar becomes a small Librarian bar. Highlight a passage if you like and ask: “tag this”, “mark this passage”, “file it with People”. It proposes changes, and nothing happens until you tick what you want and press Apply.',
          'Marking a passage saves a pointer in the note’s metadata; the text itself is never edited. Every change shows in Librarian Activity with Undo.',
        ],
        use: [
          { keys: '/librarian', text: 'Open the Librarian bar in a note.' },
          { keys: 'Open in Chat', text: 'Take the question to a full chat.' },
        ],
      },
    ],
    limits: [
      'Mac app.',
      'A raw vault never runs it. Locked and secure notes are left alone; asked about one, or about text that looks like a secret, it refuses before anything is sent.',
      'Making a new note from a highlight is planned.',
    ],
    links: [AI_GUIDE, ROADMAP],
    basis: [
      { file: 'README.md', quote: 'files each note into an area of the Library' },
      { file: 'README.md', quote: "It changes a note's location and metadata only, never the" },
      { file: 'CHANGELOG.md', quote: 'Talk to the Librarian from a note.' },
    ],
    keywords: 'organize filing tags summary ai librarian chat tag file',
  },
  {
    id: 'views',
    area: 'organizing',
    name: 'Main, views, and the Vault view',
    line: 'Arrange the notes you reach for by hand, give a project its own view, or see the folders as they are on disk.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.views,
    body: [
      'Main is your own shelf: the notes you reach for, in the order you set. A named view gives a project or a client a focused Main of its own, and new notes follow the view you are in. A note in a view is the same file on disk, never a copy.',
      'The Vault view shows the vault’s real folders and files, the way Finder does. Removing a note from Main only takes it out of view; the file stays.',
    ],
    use: [
      { keys: '⌘⇧W', text: 'Switch views.' },
      { keys: 'Remove from Main', text: 'Take a note out of view, not out of the vault.' },
    ],
    limits: [],
    links: [GETTING_STARTED],
    basis: [
      { file: 'README.md', quote: 'give a project or client its own focused Main' },
      { file: 'CHANGELOG.md', quote: 'A Vault view: your folders as they are on disk.' },
      { file: 'CHANGELOG.md', quote: 'Two-step hotkeys: ⌘⇧W for views' },
    ],
    keywords: 'sidebar main view project',
  },
  {
    // One entry for two ways of seeing notes (the owner, 2026-10-07: "condense canvas and graph
    // into one feature that is like views"). Coming soon is the graph's, built for the next
    // release; the canvas half of the same ROADMAP.md item is in development builds and is said
    // in one line, the way the roadmap page says it.
    id: 'graph',
    area: 'organizing',
    name: 'Graph and Canvas',
    line: 'See how your notes link up as a graph, and lay them out on a canvas.',
    status: 'Coming soon',
    runs: 'mac',
    icon: ICON.graph,
    picture: { kind: 'graph' },
    body: [
      'The graph shows every note as a dot and every [[link]] you wrote as a line. Hover a note to see what it links to, or open the graph from one note to see the notes around it, one or two steps out. Links the Librarian found show as dashed lines, and you can hide them.',
      'Nothing is written into your notes, and a secure note shows only its title.',
    ],
    use: [
      { keys: '⌘K → Graph', text: 'See every note and link.' },
      { keys: 'Show in graph', text: 'From a note’s menu, the notes around it.' },
    ],
    limits: [
      'Not in a release yet.',
      'The canvas, cards on an open plane saved as .canvas files that Obsidian also opens, is in development builds.',
    ],
    links: [ROADMAP],
    roadmap: 'canvas',
    keywords: 'graph links map network canvas json canvas obsidian cards',
  },

  // ─── AI and chat ──────────────────────────────────────────────────────
  {
    id: 'chat',
    area: 'ai',
    name: 'Chat with your notes',
    line: 'Ask what shipped or what you decided last week, and get an answer from your own notes.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.chat,
    picture: {
      kind: 'shot',
      src: '/shots/chat.webp',
      width: 1800,
      height: 850,
      alt: 'A rotli chat answering what already shipped and what is next on a Q4 launch plan, with lists drawn from the notes',
    },
    body: [
      'Chat reads the vault you are in, or the note you started it from, and answers from what is actually there. After every reply it keeps a short “Conversation notes” section: decisions, action items, open questions. Each chat is saved as Markdown in your chats folder.',
      'Flip the globe for a web lookup. In the Mac app, chat can also make a note, a Word document, a PDF, or a board, filed beside the chat, and it can open in a window of its own.',
    ],
    use: [
      { keys: 'Chat with this note', text: 'Start a chat about the open note, from its menu.' },
      { keys: 'The globe', text: 'Let the answer look something up on the web.' },
    ],
    limits: [
      'Use a model on your Mac or an AI tool you have installed; rotli sells no AI plan.',
      'Attachments you can see in the conversation are coming soon.',
    ],
    links: [AI_GUIDE],
    basis: [
      { file: 'README.md', quote: 'Chat that knows your notes.' },
      { file: 'README.md', quote: 'Flip the globe for a web lookup.' },
      { file: 'CHANGELOG.md', quote: 'Chat in its own window.' },
      { file: 'CHANGELOG.md', quote: "Chat's “create a PDF” uses the same themed renderer." },
      { file: 'CHANGELOG.md', quote: 'Rotli Helper: chat on the web.' },
    ],
    keywords: 'ask question assistant llm',
  },
  {
    id: 'connected-ai',
    area: 'ai',
    name: 'Your choice of AI',
    line: 'A model that runs on your Mac with no network, or Claude Code, Codex, and Cursor through their own tools; rotli never holds your keys.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.plug,
    picture: { kind: 'terminal' },
    body: [
      'Install a tool and sign in to it in Terminal, the way its maker says. rotli runs that tool for chat and the Librarian. It never signs in for you, reads the tool’s login files, or stores its credentials.',
      'Cursor answers code questions. On Rotli Web the same tools are reached through Rotli Helper on your own computer.',
    ],
    use: [{ keys: 'Settings → AI Models', text: 'Each tool’s install and sign-in lines, and whether it is ready.' }],
    sections: [
      {
        id: 'on-device-ai',
        title: 'AI on your Mac',
        body: [
          'Chat and the Librarian can use a model that runs on this Mac, with no network and nothing to sign in to, so they work offline. It is the one kind of model that may read secure notes, unless you turn that off too.',
        ],
        use: [{ keys: 'Settings → AI Models', text: 'Choose the model chat and the Librarian use.' }],
      },
    ],
    limits: ['The model on your Mac is in the Mac app.', 'Secure notes never reach the connected tools.'],
    links: [AI_GUIDE, PRIVACY],
    basis: [
      { file: 'README.md', quote: 'official Claude Code, Codex, or Cursor client already installed' },
      { file: 'README.md', quote: 'Rotli never shows a provider login or reads provider credentials.' },
      { file: 'README.md', quote: 'On-device by default' },
      { file: 'README.md', quote: 'on-device models can, unless you turn that off.' },
    ],
    keywords: 'claude codex cursor openai anthropic cli local model offline mlx on-device',
  },
  {
    id: 'hand-to-ai',
    area: 'ai',
    name: 'Hand to AI',
    line: 'Turn a note into a prompt for Claude Code or another agent: the goal, the open tasks, and what done means.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.handoff,
    body: [
      'rotli builds the prompt from the note alone: the goal, the open tasks and what is already done, the note as context, and what “done” means. No model runs. Edit it, then copy it.',
    ],
    use: [
      { keys: 'Hand to AI…', text: 'From the palette or a note’s menu.' },
      { keys: '/hand to AI', text: 'The same window, from inside the note.' },
    ],
    limits: [
      'A secure note, or one that looks like it holds a secret, is never turned into a prompt.',
      'A Refined mode, where a model rewrites the prompt, is being built.',
    ],
    links: [ROADMAP],
    next: 'hand-to-ai',
    basis: [{ file: 'CHANGELOG.md', quote: 'Choose "Hand to AI…" from the palette or a note\'s menu' }],
    keywords: 'prompt agent claude code handoff',
  },
  {
    id: 'ai-in-a-note',
    area: 'ai',
    name: '/ai in a note',
    line: 'Type /ai, say what you want, and the answer lands in the note where you typed it.',
    status: 'Coming soon',
    runs: 'mac',
    icon: ICON.sparkle,
    body: ['Secure and locked notes follow the same AI rules as everywhere else.'],
    use: [{ keys: '/ai', text: 'Ask in place.' }],
    limits: ['Not in a release yet.'],
    links: [ROADMAP],
    roadmap: 'ai-inline',
  },
  {
    id: 'chat-attachments',
    area: 'ai',
    name: 'Chat attachments you can see',
    line: 'Files you attach to a chat show as thumbnails, and as small tags in the message they went with.',
    status: 'Coming soon',
    runs: 'mac',
    icon: ICON.clip,
    body: ['So you can tell what went with each question.'],
    use: [],
    limits: ['Not in a release yet.'],
    links: [ROADMAP],
    roadmap: 'chat-attachments',
  },
  {
    id: 'breve',
    area: 'ai',
    name: 'Breve, the morning brief',
    line: 'A morning brief and its routines, written for you on a schedule.',
    status: 'In development',
    runs: 'mac',
    icon: ICON.brief,
    body: ['Breve runs in development builds today.'],
    use: [],
    limits: ['Development builds only.'],
    links: [ROADMAP],
    roadmap: 'breve-public',
  },

  // ─── Files ────────────────────────────────────────────────────────────
  {
    id: 'docs',
    area: 'files',
    name: 'Word and Excel files',
    line: 'Open and edit Word documents (.docx) and Excel workbooks (.xlsx) in the Mac app. They stay ordinary Office files.',
    status: DOCS_AND_SHEETS.status,
    runs: 'mac',
    icon: ICON.doc,
    picture: { kind: 'doc' },
    body: [`Open and edit Word documents in the Mac app, in ${DOCS_AND_SHEETS.inline}.`],
    use: [],
    sections: [
      {
        id: 'sheets',
        title: 'Excel workbooks',
        picture: { kind: 'sheet' },
        body: [`Open and edit Excel workbooks in the Mac app, in ${DOCS_AND_SHEETS.inline}.`],
      },
    ],
    limits: ['Mac app only, for now.'],
    links: [],
    roadmap: ['docs-beta', 'sheets-beta'],
    keywords: 'docx word document xlsx excel spreadsheet sheets csv univer',
  },
  {
    id: 'boards',
    area: 'files',
    name: 'Boards and pictures',
    line: 'Sketch on an Excalidraw canvas and drop images into a note; each stays an ordinary file in your vault.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.board,
    picture: {
      kind: 'shot',
      src: '/shots/board.webp',
      width: 1500,
      height: 470,
      alt: 'An Excalidraw board in rotli titled Launch map, with Capture, Note, and Library boxes joined by arrows',
    },
    body: [
      'A board is an Excalidraw canvas in its own .excalidraw file, beside your notes. A board you have not coloured yourself follows your theme, and a [[link]] to a board opens it. A link on a shape opens too: a web page in your browser, a [[note]] in its tab, another shape by scrolling to it.',
    ],
    use: [{ keys: '⌘N → Board', text: 'Make a named board.' }],
    sections: [
      {
        id: 'pictures-and-files',
        title: 'Pictures and files',
        body: [
          'Drag an image, or the macOS screenshot thumbnail, straight into a note or a chat. Pictures and files are kept in your vault’s storage folder, so the note and its pictures travel together.',
        ],
        use: [{ keys: 'Drag and drop', text: 'Into a note or a chat.' }],
      },
    ],
    limits: ['Cards on an open canvas, beside a graph of your links, are coming as Graph and Canvas.'],
    links: [],
    basis: [
      { file: 'CHANGELOG.md', quote: 'Boards on Rotli Web.' },
      { file: 'CHANGELOG.md', quote: 'Boards match your theme.' },
      { file: 'CHANGELOG.md', quote: 'A `[[link]]` to a board opens the board.' },
      { file: 'README.md', quote: 'storage/ documents, boards, images, and files' },
      { file: 'CHANGELOG.md', quote: 'Drag the macOS screenshot thumbnail straight into a note or a chat.' },
      { file: 'CHANGELOG.md', quote: 'Rotli Web: images in notes.' },
    ],
    keywords: 'excalidraw whiteboard canvas sketch drawing images assets attachments screenshot',
  },

  // ─── Privacy and control ──────────────────────────────────────────────
  {
    id: 'your-folder',
    area: 'privacy',
    name: 'One folder you own',
    line: 'Plain Markdown in a folder you choose, with no account and offline by default; bring the Obsidian or Markdown folder you already have.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.folder,
    picture: { kind: 'tree' },
    body: [
      'Every note is a Markdown file in one folder you choose. Open it in any editor, back it up however you like, and keep it long after you stop using rotli. A hidden .rotli folder holds only what rotli can rebuild.',
      'Deleting a note moves it to a Trash inside the vault. Nothing leaves your disk until you choose Empty Trash.',
    ],
    use: [{ keys: 'Empty Trash', text: 'The only way a note leaves the folder.' }],
    sections: [
      {
        id: 'open-a-folder',
        title: 'Bring the folder you have',
        body: [
          'First run can look at an existing folder without writing anything, then open it where it is or import a copy. The vault can stay open in Obsidian too.',
        ],
        use: [{ keys: 'Connect vault', text: 'Open any Markdown folder.' }],
      },
    ],
    limits: [
      'There is no sync of its own; back up the folder your way (Time Machine, a sync service, git).',
      'Looking at a folder before opening it, and importing a copy, are in the Mac app.',
      'Importing from Notion or Apple Notes is an idea on the roadmap.',
    ],
    links: [WHY_LOCAL, GETTING_STARTED, PRIVACY],
    basis: [
      { file: 'README.md', quote: 'Rotli works fully offline.' },
      { file: 'README.md', quote: 'Nothing leaves your disk\n  until you choose **Empty Trash**.' },
      { file: 'README.md', quote: 'First run can\ninspect it without writing anything' },
      { file: 'CHANGELOG.md', quote: 'Connect vault takes any folder.' },
      { file: 'CHANGELOG.md', quote: 'Your vault can stay open in Obsidian and ZenNotes too.' },
    ],
    keywords: 'local first offline files backup trash obsidian import migrate zennotes',
  },
  {
    id: 'secure-notes',
    area: 'privacy',
    name: 'You decide what AI sees and changes',
    line: 'Secure notes never reach remote AI or the web, notes you wrote stay as you wrote them until you allow edits, and Lock stops every AI.',
    status: 'Shipped',
    runs: 'both',
    icon: ICON.shield,
    picture: { kind: 'menu' },
    body: [
      'A secure note moves to a protected folder in your vault and stays away from remote models and the web; the Librarian leaves it alone. Text that looks like a secret (API keys, private keys, card and identity numbers) is treated the same way.',
      'The model on your Mac can still read a secure note, unless you turn that off.',
    ],
    use: [
      { keys: '⌘⇧L', text: 'Mark the open note secure, or not.' },
      { keys: 'Settings → Librarian → Your rules', text: 'Secure keywords: names that make a note secure.' },
    ],
    sections: [
      {
        id: 'what-ai-may-change',
        title: 'What AI may change',
        body: [
          'Chat, agents, and the Librarian may change the text of a note an AI made. A note you wrote stays yours until you turn on Let AI edit the text in its menu.',
          'Lock goes further: no AI may edit or file the note, the model on your Mac included. Every model can still read it.',
        ],
        use: [
          { keys: 'Let AI edit the text', text: 'Allow AI edits to a note you wrote.' },
          { keys: 'Lock', text: 'No AI edits or files it.' },
        ],
      },
    ],
    limits: ['Anyone at your Mac can still open a secure note; Touch ID for them is an idea.'],
    links: [PRIVACY],
    basis: [
      { file: 'README.md', quote: 'Rotli moves it to `wiki/_secure/`' },
      { file: 'CHANGELOG.md', quote: '⌘⇧L turns Secure on and off for the open note' },
      { file: 'CHANGELOG.md', quote: 'Settings → Librarian → Your rules tells the' },
      { file: 'CHANGELOG.md', quote: 'AI no longer rewrites notes you wrote.' },
      { file: 'README.md', quote: 'changes location and metadata only' },
    ],
    keywords: 'private secret remote ai lock permission edit protect',
  },

  // ─── Rotli Web and agents ─────────────────────────────────────────────
  {
    id: 'rotli-web',
    area: 'web',
    name: 'Rotli Web',
    line: 'The same editor in your browser, while your notes stay in a folder on your computer.',
    status: 'Shipped',
    runs: 'web',
    icon: ICON.globe,
    body: [
      'Chrome, Edge, and Arc open your folder directly: every note is a file there, the same files the Mac app reads. No account; the page talks to nothing but your own computer.',
    ],
    use: [{ keys: 'Connect vault', text: 'Open a folder on this computer.' }],
    sections: [
      {
        id: 'rotli-helper',
        title: 'Rotli Helper',
        body: [
          'Firefox, Zen, and Brave can’t open a folder, and no browser tab can start the AI tools you have installed. Rotli Helper, a small program on your computer, does both, for rotli.co only. It runs on Mac, Windows, and Linux; the guide explains how.',
        ],
      },
    ],
    limits: [
      'Safari and phones are not supported yet.',
      'The Librarian, Word documents, and sheets stay in the Mac app.',
    ],
    links: [{ href: WEB_APP_PATH, label: 'Open Rotli Web' }, WEB_AND_MAC, HELPER_GUIDE],
    basis: [
      { file: 'CHANGELOG.md', quote: 'Rotli Web (first phase).' },
      { file: 'CHANGELOG.md', quote: '`rotli-helper`, Mac, Windows, and Linux' },
    ],
    needsWebApp: true,
    keywords: 'browser chrome edge arc online firefox zen brave helper',
  },
  {
    id: 'command-line',
    area: 'web',
    name: 'A command line for scripts',
    line: 'The installed app is also a JSON command line that follows the same rules as the app.',
    status: 'Shipped',
    runs: 'mac',
    icon: ICON.terminal,
    body: [
      'List, search, query, and create notes from a script. New notes enter the same intake as the app’s, secure notes stay out of reach, locked notes refuse edits, and every update needs a fresh revision.',
    ],
    use: [
      { keys: 'rotli notes search "launch plan"', text: 'Search the vault.' },
      { keys: "rotli notes query 'area:projects'", text: 'Query by area, tag, or date.' },
    ],
    limits: ['Mac app.'],
    links: [DEVELOPERS],
    basis: [{ file: 'README.md', quote: 'The installed app is also a JSON CLI that follows the same rules as the app' }],
    keywords: 'cli terminal json scripting',
  },
  {
    id: 'agents-mcp',
    area: 'web',
    name: 'MCP for AI agents',
    line: 'Let an AI agent work in your vault under rotli’s own rules, through MCP and the agent commands.',
    status: 'In development',
    runs: 'mac',
    icon: ICON.agent,
    body: ['The same rules as the app: secure notes stay out of reach, locked notes refuse edits, and every AI edit is recorded.'],
    use: [],
    limits: ['Development builds only.'],
    links: [DEVELOPERS],
    roadmap: 'agents-mcp',
  },
];

/** The catalog this build shows: the policy gates applied once, for every page that lists features. */
export function visibleFeatures(): Feature[] {
  return FEATURES.filter(
    (feature) =>
      (feature.status !== 'In development' || site.showsExperiments) &&
      (!feature.needsWebApp || site.webAppEnabled),
  );
}

/** Every entry, gates ignored: the honesty test reads this. */
export const ALL_FEATURES: readonly Feature[] = FEATURES;

/** The ROADMAP.md items an entry names, as a list. */
export const roadmapIds = (feature: Feature): string[] =>
  feature.roadmap === undefined ? [] : [feature.roadmap].flat();

/**
 * Where each entry folded into another (2026-10-06) now lives, by old id: its section on the
 * surviving page ("diagrams" → "/features/markdown/#diagrams"), or the page's top when its words
 * lead it (`formerly`). From the given entries, so the Caddyfile's test can read every one.
 */
export function movedFrom(features: readonly Feature[]): Record<string, string> {
  return Object.fromEntries(
    features.flatMap((feature) => [
      ...(feature.formerly ?? []).map((id) => [id, featurePath(feature)]),
      ...(feature.sections ?? []).map((section) => [section.id, `${featurePath(feature)}#${section.id}`]),
    ]),
  );
}

/**
 * The redirects this build writes (astro.config.mjs, as refresh pages): only to pages it has, so
 * none lands on a page that isn't there. site/Caddyfile answers the same paths with a permanent
 * redirect in production.
 */
export const movedFeatures = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(movedFrom(visibleFeatures())).map(([id, to]) => [`/features/${id}`, to]),
  );

export const areaOf = (feature: Feature): Area => AREAS.find((area) => area.id === feature.area)!;

/** Areas with at least one visible feature, each with its features in catalog order. */
export function catalog(): { area: Area; features: Feature[] }[] {
  const shown = visibleFeatures();
  return AREAS.map((area) => ({ area, features: shown.filter((f) => f.area === area.id) })).filter(
    (group) => group.features.length > 0,
  );
}

/** Out today, in a release (Shipped or Beta). */
export const isOut = (feature: Feature) => feature.status === 'Shipped' || feature.status === 'Beta';

/** A place rotli runs, in the order the availability line names them. */
export type Platform = 'Mac' | 'Windows' | 'Linux' | 'Web';
const PLATFORM_ORDER: readonly Platform[] = ['Mac', 'Windows', 'Linux', 'Web'];

/** Where an entry runs, as platforms. Web only while Rotli Web is offered; never Windows or Linux. */
export function platformsFor(runs: Feature['runs'], webAppEnabled: boolean): Platform[] {
  if (!webAppEnabled) return ['Mac'];
  return runs === 'both' ? ['Mac', 'Web'] : runs === 'web' ? ['Web'] : ['Mac'];
}

/**
 * The one availability line (the owner, 2026-10-06: "Available on Mac and Web", "Available on
 * Mac", "Available on Mac, Windows and Web"): Shipped "Available on …", Beta "Beta on …",
 * Coming soon "Coming soon to …", In development just that. Platforms join with commas and a
 * final "and", in a fixed order, whatever order they arrive in.
 */
export function availability(status: Status, platforms: readonly Platform[]): string {
  const named = PLATFORM_ORDER.filter((platform) => platforms.includes(platform));
  if (status === 'In development' || named.length === 0) return status;
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
  if (status === 'Shipped') return `Available on ${list}`;
  if (status === 'Beta') return `Beta on ${list}`;
  return `Coming soon to ${list}`;
}

/** A feature's availability line in this build: the tile, its page, the twin, and llms.txt. */
export const availabilityOf = (feature: Feature) =>
  availability(feature.status, platformsFor(feature.runs, site.webAppEnabled));

export const featurePath = (feature: Feature) => `/features/${feature.id}/`;

/** What a merged entry also covers, for text-only lists (the twin, llms.txt): " Also: Mermaid diagrams." */
export const alsoCovers = (feature: Feature): string =>
  feature.sections?.length ? ` Also: ${feature.sections.map((section) => section.title).join('; ')}.` : '';

/** The catalog as Markdown: /features/index.md, linked from /llms.txt. */
export function catalogMarkdown(origin: string): string {
  const lines = [
    '# Everything rotli does',
    '',
    `> Every capability, grouped by area, with where it is available today (${DOCS_AND_SHEETS.status} is usable and still being finished; Coming soon is in the next release). ${PLATFORMS.availability}`,
  ];
  for (const { area, features } of catalog()) {
    lines.push('', `## ${area.name}`, '', area.line, '');
    for (const feature of features) {
      lines.push(
        `- [${feature.name}](${origin}${featurePath(feature)}) (${availabilityOf(feature)}): ${feature.line}${alsoCovers(feature)}`,
      );
    }
  }
  lines.push('', '---', '', `What is being built next: ${origin}/roadmap/`, '');
  return lines.join('\n');
}
