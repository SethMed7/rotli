// The Aa panel's Secure / AI-edits rows must show what every other surface
// shows. 2026-11-24: ⌘⇧L moved a note into Library › Secure notes (the header
// followed) while the open panel kept its first read. The panel now reads the
// shared note-protection query, which every write path refreshes through
// invalidateNotes — the chord, the row menu, the panel itself, a file changed
// outside Rotli. `mock.module` is process-wide: each mock spreads a SNAPSHOT of
// the real module and afterAll restores it.

import { afterAll, expect, mock, test } from "bun:test";

import { QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import * as liveFocus from "../keys/focusNow";
import * as liveProtection from "../lib/noteProtection";
import * as liveTauri from "../lib/tauri";

const realTauri = { ...liveTauri };
const realProtection = { ...liveProtection };
const realFocus = { ...liveFocus };

const NOTE = "01JNOTEAAAAAAAAAAAAAAAAAAA";
const disk = { secure: false, aiEdit: "person-written" as "person-written" | "allowed" };

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  isTauri: () => true,
  corpusFrontmatter: async () => ({
    id: NOTE,
    created: "",
    updated: "",
    locked: false,
    secure: disk.secure,
    localAiAllowed: true,
    pinned: false,
    aiBodyEdit: disk.aiEdit,
    fields: [],
  }),
}));
void mock.module("../lib/noteProtection", () => ({
  ...realProtection,
  corpusSetSecure: async (_id: string, secure: boolean) => {
    disk.secure = secure;
  },
  corpusSetAiEdit: async (_id: string, allowed: boolean) => {
    disk.aiEdit = allowed ? "allowed" : "person-written";
  },
}));
void mock.module("../keys/focusNow", () => ({
  ...realFocus,
  notesWorkspaceActive: () => true,
  focusedNoteIdNow: () => NOTE,
}));
afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
  void mock.module("../lib/noteProtection", () => realProtection);
  void mock.module("../keys/focusNow", () => realFocus);
});

const { queryClient } = await import("../services/query");
const { invalidateNotes } = await import("../services/hooks");
const { noteProtectionOptions } = await import("../services/noteProtectionQuery");
const { TOGGLE_SECURE_ACTION, registerNoteProtectionActions } = await import("../keys/noteProtectionActions");
const { getAction } = await import("../keys/registry");
const { AaPanel } = await import("./aaPanel");

registerNoteProtectionActions();

// the mounted panel is an observer of this query
const panel = new QueryObserver(queryClient, noteProtectionOptions(NOTE));
panel.subscribe(() => {});

const markup = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AaPanel noteId={NOTE} anchorRef={{ current: null }} onClose={() => {}} />
    </QueryClientProvider>,
  );

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

/** Which of a segmented row's two buttons is pressed, by its group name. */
function pressed(html: string, group: string): string {
  const row = html.slice(html.indexOf(`aria-label="${group}"`));
  const end = row.indexOf("</div>");
  const buttons = [...row.slice(0, end).matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)</g)];
  return buttons.find((b) => b[1] === "true")?.[2] ?? "none";
}

test("the panel shows the note's own state before anything is pressed", async () => {
  await queryClient.fetchQuery(noteProtectionOptions(NOTE));
  expect(pressed(markup(), "Secure note")).toBe("Off");
  expect(pressed(markup(), "AI edits")).toBe("Off");
});

test("⌘⇧L through the registry flips the open panel, both ways", async () => {
  getAction(TOGGLE_SECURE_ACTION)?.run();
  await until(() => disk.secure === true);
  await until(() => panel.getCurrentResult().data?.secure === true);
  expect(pressed(markup(), "Secure note")).toBe("Secure");

  getAction(TOGGLE_SECURE_ACTION)?.run();
  await until(() => panel.getCurrentResult().data?.secure === false);
  expect(pressed(markup(), "Secure note")).toBe("Off");
});

test("the panel's own switch writes, then reads the file back", async () => {
  const { toggleNoteSecure } = await import("../keys/noteProtectionActions");
  await toggleNoteSecure(NOTE);
  await until(() => panel.getCurrentResult().data?.secure === true);
  expect(pressed(markup(), "Secure note")).toBe("Secure");
  await toggleNoteSecure(NOTE);
  await until(() => panel.getCurrentResult().data?.secure === false);
});

test("a change made outside the panel — the row menu, a CLI, another editor — shows in the panel", async () => {
  disk.secure = true;
  disk.aiEdit = "allowed";
  await invalidateNotes();
  await until(() => panel.getCurrentResult().data?.aiBodyEdit === "allowed");
  const html = markup();
  expect(pressed(html, "Secure note")).toBe("Secure");
  expect(pressed(html, "AI edits")).toBe("Allowed");
  disk.secure = false;
  disk.aiEdit = "person-written";
  await invalidateNotes();
  await until(() => panel.getCurrentResult().data?.secure === false);
  expect(pressed(markup(), "Secure note")).toBe("Off");
});

test("another note's panel does not borrow this note's state", async () => {
  disk.secure = true;
  await invalidateNotes();
  await until(() => panel.getCurrentResult().data?.secure === true);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AaPanel noteId="01JOTHERBBBBBBBBBBBBBBBBBB" anchorRef={{ current: null }} onClose={() => {}} />
    </QueryClientProvider>,
  );
  // nothing read for it yet: neither segment claims to be pressed
  expect(pressed(html, "Secure note")).toBe("none");
});
