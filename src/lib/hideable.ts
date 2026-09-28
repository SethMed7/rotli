// What a person can hide (the owner, 2026-09-28: "a place in settings where
// you can choose things to hide, like the overview or the browser button").
// Settings → Appearance → Show in Rotli lists these; each is shown unless
// switched off, and hiding one never removes what it does: every item keeps a
// way in, named in its description (another button, or `still`: a shortcut
// or ⌘K, shown only where Rotli shows shortcuts; Rotli Web names none).

export const HIDEABLE = [
  {
    id: "newButton",
    group: "Title bar",
    title: "New",
    desc: "The + that opens the New chooser.",
    still: "⌘N",
  },
  {
    id: "splitButtons",
    group: "Title bar",
    title: "Split buttons",
    desc: "Split right and Split down.",
    still: "⌘D and ⌘⇧D",
  },
  {
    id: "browserButton",
    group: "Title bar",
    title: "Browser",
    desc: "The globe that opens a private browser tab; the New chooser has it too.",
    still: "in ⌘K",
  },
  {
    id: "themeButton",
    group: "Title bar",
    title: "Theme",
    desc: "The sun that cycles themes; Appearance has them too.",
    still: "in ⌘K",
  },
  {
    id: "history",
    group: "Title bar",
    title: "Back and forward",
    desc: "The arrows through the notes you opened.",
    still: "⌘[ and ⌘]",
  },
  {
    id: "search",
    group: "Title bar",
    title: "Search",
    desc: "The search field.",
    still: "⌘K, which opens it in its place",
  },
  {
    id: "overview",
    group: "Sidebar",
    title: "Activity overview",
    desc: "The “This week” card on Home and the Model usage card on Chat.",
    still: "in ⌘K, as the Rotli activity dashboard",
  },
  {
    id: "allNotes",
    group: "Sidebar",
    title: "All notes",
    desc: "The row at the top of Home.",
    still: "in ⌘K",
  },
  {
    id: "captures",
    group: "Sidebar",
    title: "Captures",
    desc: "The row at the top of Home.",
    still: "in ⌘K",
  },
  { id: "tasks", group: "Sidebar", title: "Tasks", desc: "The row at the top of Home.", still: "in ⌘K" },
  {
    id: "breve",
    group: "Sidebar",
    title: "Breve",
    desc: "The Breve switch beside Home and Chat.",
    still: "⌘⇧B",
  },
  { id: "files", group: "Sidebar footer", title: "Files", desc: "Opens the vault in Finder." },
  {
    id: "librarian",
    group: "Sidebar footer",
    title: "Librarian",
    desc: "Its badges go with it; Librarian Activity stays in Settings → Librarian.",
  },
  {
    id: "feedback",
    group: "Sidebar footer",
    title: "Feedback",
    desc: "Settings → About has it too.",
    still: "in ⌘K",
  },
  {
    id: "tabPlus",
    group: "Tabs",
    title: "New tab +",
    desc: "The + at the end of each tab strip.",
    still: "⌘T",
  },
] as const;

export type HideId = (typeof HIDEABLE)[number]["id"];

/** Only what is hidden is listed; anything else shows. */
export type Hidden = Partial<Record<HideId, true>>;

const ids = new Set<string>(HIDEABLE.map((item) => item.id));

/** Read tolerantly: unknown names and anything but `true` are dropped. */
export function parseHidden(value: unknown): Hidden {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const hidden: Hidden = {};
  for (const [id, on] of Object.entries(value)) if (ids.has(id) && on === true) hidden[id as HideId] = true;
  return hidden;
}

/** What an item's switch says: what it is, and how to reach it without it. */
export function hideDescription(item: { desc: string; still?: string }, showKeys: boolean): string {
  return showKeys && item.still ? `${item.desc} Still ${item.still}.` : item.desc;
}
