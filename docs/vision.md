# rotli — Vision

The product's north star. What it is, who it's for, why it exists. Where [model.md](./model.md) governs the objects and vocabulary and [philosophy.md](./philosophy.md) governs how it should feel, this doc governs the shape of the whole.

---

## One sentence

A warm, local-first Mac menu-bar app that quietly absorbs your notes, your thinking, and your email into one folder you own — a memex — and gives you a calm window onto it.

---

## The customer, in one image

The quokka. Small, focused, always smiling — because the environment it lives in was designed for it. rotli is the island. Every surface is a part of the island. The user doesn't need to learn the island's layout; the layout is obvious. Nothing surprises them. Nothing demands. The view from any surface is warm and quiet. They get more done than they expected, and they don't know exactly why, and that is the feature.

---

## The frustrations this answers

Each one comes from something that exists and works in pieces but has never been combined without losing its feel.

| Existing tool | Where it falls short | What rotli does |
|---|---|---|
| **Apple Mail** | Hard to tell at a glance which inbox sent what. Smart inboxes hide too much. | Per-inbox color identity everywhere — list, thread, notification. No hidden rules. |
| **Gmail web** | No good Mac client. Awful for managing many accounts at once. | Native Mac menu-bar app. A calm layer over your own email, per-account. |
| **Superhuman / Fyxer** | Team-priced. Overbuilt. Assumes a specific workflow. | Personal tool first. Keyboard-driven. No opinions about how you should work. |
| **Apple Notes** | Dock presence. Permanent sidebar. No split view. Weak markdown. | Menu-bar only. Sidebar toggle. Native split view. Real markdown with rich rendering inline. |
| **Raycast Notes** | 5-note free cap. No resize. No tabs. No split. Only three font sizes, no color. | Unlimited notes. Resize anywhere. Tabs + splits. Full font / color / highlight control. |
| **Notion** | Slow. Heavy. Clinical. | Instant. Local-first. Warm. |
| **Obsidian** | Plugin-dependent for basic polish. Organizing the vault is all on you. | Beautiful defaults built in. And an AI organizer that files your notes for you — you just capture. |

rotli doesn't try to be better at all of these at once. It tries to be the one warm place where each thing is just *okay enough* that you stop leaving the app to do it elsewhere. Context stays in one surface.

---

## What we are building

One menu-bar shell over **one memex** — a single local folder that holds your notes, chats, knowledge, and files. Three fronts sit over it:

```
┌────────────────────────────────────────────────────────────┐
│                     rotli (menu bar)                        │
│                                                             │
│     ┌─────────┐        ┌────────┐        ┌────────┐         │
│     │  Inbox  │        │  Chat  │        │ Notes  │         │
│     │ (email) │        │  (AI)  │        │        │         │
│     └─────────┘        └────────┘        └────────┘         │
│                                                             │
│   one memex underneath — plain files you own, on your Mac   │
└────────────────────────────────────────────────────────────┘
```

| Front | What it is |
|---|---|
| **Notes** | The anchor. Quick capture, tabs, splits, nested folders, a hybrid markdown editor. Inside Notes: **Capture** (jot without deciding where it goes), **the brain** (AI-organized areas — People · Projects · Research), **Storage** (your files/images/PDFs), and **Boards** (Excalidraw canvases). The surface you spend the most time in. |
| **Chat** | Your AI conversations. The model is an agentic client — your memex *is* its knowledge base, so it searches and reads your notes to answer. Runs on-device by default, or on your own connected models. Every chat carries a note. |
| **Inbox** | Your email — a calm layer over your own accounts, with per-inbox identity and quiet notifications. (Planned.) |

The **memex** underneath is the point: your notes folder *is* the brain. You capture; an on-device organizer files things into areas for you (it only ever changes a note's location and metadata, never its words). Power users can work in the areas directly, but most people never have to — they just take notes and let the AI organize.

Everything composes; nothing demands. If you only use Notes, Notes is the whole app for you.

---

## Non-negotiable product promises

1. **Menu bar, not dock.** No icon in the dock, no presence in ⌘Tab, no badges. You summon it; you dismiss it.
2. **Global hotkey from anywhere.** `⌥Space` by default. Fully rebindable.
3. **Click-away closes.** The app is a visitor on your screen, not a resident.
4. **Local-first by design.** Plain files in one folder on your Mac are the source of truth. Everything works offline except fetching new email.
5. **No account, no setup, no rotli server — ever.** Nothing to install but rotli. AI is optional and yours: on-device by default, or your own connected models (the subscription CLIs already signed in on your Mac — Claude Code, Codex, Antigravity). A note flagged **secure** never reaches a remote model or the web.
6. **Fully rebindable hotkeys for every action.** No Karabiner. No shell aliases.
7. **Every icon has a label on hover.** The quokka never has to learn the island's secret symbols.
8. **Notifications are never louder than they need to be.** Per-inbox chip, subject optional, auto-redacted while screen-sharing.

---

## Platform principles

### 1. Feel before function
We don't ship features that make the app more capable at the cost of making it feel heavier. Every new surface is graded against how it feels after 30 minutes of use, not against what it can do in a demo. See [philosophy.md](./philosophy.md).

### 2. Local before cloud
Data lives on your Mac as plain files. The cloud is a convenience, not a requirement. Sync, when it exists, is a relay — never the source of truth. If it disappears, rotli keeps working forever.

### 3. Warmth is the brand
Every surface is warm. Every default is the kind option for your eyes. The linen light mode, the clay accent, the near-zero-blue night mode — these are the same across every surface. The user's eyes never get a jolt when switching.

### 4. Personal before team
Solo-use works perfectly before any team features show up. Collaboration layers on later; it never compromises the solo experience. If a collab feature would make the solo version worse, it gets cut, not ship-anyway-with-a-setting.

### 5. Rebindable by default
The user owns their hotkeys. The user owns their themes. The user owns their notifications. Every "the app does X when Y" is settable.

### 6. Each surface earns its place
A feature doesn't ship because a competitor has it or because we could build it. It ships because it solves a frustration the user names when describing their day.

---

## What we refuse to be

- **Not a document editor.** Notes are plain markdown you own; everything rich is a render-only layer. If you need page layout and rulers, export.
- **Not a project management tool.** No sprints, no tickets, no assignees. A Board is a thinking surface, not a Kanban.
- **Not a chat app.** Not Slack, not Discord. Those are separate apps for good reason.
- **Not a calendar.** Your calendar doesn't need to be in rotli.
- **Not a replacement for your mail provider.** Inbox is a calm *layer over* your email, not a full-feature client.
- **Not a browser.** No embedded web views except for OAuth flows and rendered email HTML (sandboxed).
- **Not cross-platform.** Mac first. iPad later, with its own pen-first direction (see [future/ipad-handdrawing-chandra.md](./future/ipad-handdrawing-chandra.md)). Windows and Linux are not on the map.
- **Not a voice app.** Dictation and read-aloud live in a separate menu-bar tool, *voz* — rotli stays a notes app.

---

## What success looks like

You sit down at your Mac. You press `⌥Space`. A warm calm window appears. You type a thought — two sentences, maybe a list. You press `⌥Space`. The window disappears. You never decided where the note goes; the organizer files it into the right area later, quietly.

An hour later a new email hits your work account. A small clay chip appears in the corner of your screen, labeled "work." You glance, dismiss it, keep working.

At the end of the day you open Chat and type: *what did I decide about the pricing model this week?* The model reads your own notes and answers in three sentences, pointing at the two notes where the decision actually happened. You forgot you'd written any of it down.

That's the feature. The quokka is smiling. You made more progress than you thought, and you don't know exactly why — but you know you'll open rotli again tomorrow.

---

## What this doc is not

- **Not a roadmap** — see [next-stages.md](./next-stages.md) for sequencing.
- **Not the object model** — [model.md](./model.md) owns the canonical objects and vocabulary.
- **Not a design system** — [design-system.md](./design-system.md) owns visual rules.
- **Not immutable** — if the vision shifts, this doc gets rewritten. Don't patch; replace.
