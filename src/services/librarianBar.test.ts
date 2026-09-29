import { describe, expect, test } from "bun:test";

import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import type { FrontmatterView } from "../lib/tauri";
import {
  applyLibrarian,
  LIBRARIAN_REFUSALS,
  type LibrarianDeps,
  converseLibrarian,
  librarianRefusal,
} from "./librarianBar";

function view(fields: string[], extra: Partial<FrontmatterView> = {}): FrontmatterView {
  return {
    id: "01NOTE",
    created: "",
    updated: "",
    locked: false,
    secure: false,
    localAiAllowed: false,
    pinned: false,
    fields,
    ...extra,
  };
}

function fakeDeps(fm: FrontmatterView | null, rel = "wiki/_inbox/maya.md") {
  const calls: string[] = [];
  const deps: LibrarianDeps = {
    frontmatter: async () => fm,
    notePath: async () => rel,
    setAiField: async (_id, key, value) => {
      calls.push(`set ${key} ${value}`);
    },
    log: async (row) => {
      calls.push(`log ${row.field} ${row.before} -> ${row.after}`);
    },
    learnField: async (_note, key) => {
      calls.push(`learn ${key}`);
    },
    fileNote: async (_id, area) => {
      calls.push(`file ${area}`);
      return `wiki/${area}/maya.md`;
    },
    refresh: async () => {
      calls.push("refresh");
    },
  };
  return { deps, calls };
}

describe("who may ask", () => {
  const on = { native: true, librarianOn: true };
  test("each refusal says why, before any model call", async () => {
    const { deps } = fakeDeps(view([]));
    expect(await librarianRefusal("n", { native: false, librarianOn: true }, deps)).toBe(
      LIBRARIAN_REFUSALS.web,
    );
    expect(await librarianRefusal("n", { native: true, librarianOn: false }, deps)).toBe(
      LIBRARIAN_REFUSALS.off,
    );
    expect(await librarianRefusal("n", on, fakeDeps(view([], { locked: true })).deps)).toBe(
      LIBRARIAN_REFUSALS.locked,
    );
    expect(await librarianRefusal("n", on, fakeDeps(view([], { secure: true })).deps)).toBe(
      LIBRARIAN_REFUSALS.secure,
    );
    expect(await librarianRefusal("n", on, fakeDeps(view([]), "chats/x.md").deps)).toBe(
      LIBRARIAN_REFUSALS.library,
    );
    expect(await librarianRefusal("n", on, fakeDeps(view([]), "wiki/_secure/x.md").deps)).toBe(
      LIBRARIAN_REFUSALS.library,
    );
    expect(await librarianRefusal("n", on, deps)).toBeNull();
  });

  test("a note named with a secure keyword is refused before anything is sent", async () => {
    const { deps } = fakeDeps(view([]), "wiki/_inbox/salary-2026.md");
    const keywords = { ...on, secureKeywords: ["salary"] };
    expect(await librarianRefusal("n", keywords, deps)).toBe(LIBRARIAN_REFUSALS.secure);
    const titled = fakeDeps(view([]), "wiki/_inbox/x.md").deps;
    expect(await librarianRefusal("n", { ...keywords, title: "Salary review" }, titled)).toBe(
      LIBRARIAN_REFUSALS.secure,
    );
    expect(await librarianRefusal("n", { ...keywords, title: "Salaryman films" }, titled)).toBeNull();
  });

  test("metadata that can't be read counts as locked", async () => {
    expect(await librarianRefusal("n", on, fakeDeps(null).deps)).toBe(LIBRARIAN_REFUSALS.locked);
  });
});

describe("asking", () => {
  const ctx = {
    title: "Maya",
    doc: "Met Maya at the meetup.",
    areas: ["Projects"],
    tags: [],
    people: ["People"],
    filing: [],
    rules: structuredClone(DEFAULT_LIBRARIAN_RULES),
    known: [],
  };
  const first = [{ role: "user" as const, text: "tag this", highlight: null }];

  test("secret-shaped text never reaches the model, wherever it sits in the conversation", async () => {
    let called = false;
    const host = {
      complete: async () => {
        called = true;
        return "{}";
      },
    };
    const secret = { ...ctx, doc: "api key sk-ant-abcdefghijklmnopqrstuvwx" };
    expect(await converseLibrarian(secret, first, host)).toEqual({ kind: "secret" });
    const later = [
      ...first,
      { role: "user" as const, text: "sk-ant-abcdefghijklmnopqrstuvwx", highlight: null },
    ];
    expect(await converseLibrarian(ctx, later, host)).toEqual({ kind: "secret" });
    expect(called).toBe(false);
  });

  test("a reply comes back as prose and the actions within the grammar", async () => {
    let sent: { role: string }[] = [];
    const host = {
      complete: async ({ messages }: { messages: { role: string }[] }) => {
        sent = messages;
        return 'Tagging it as a person.\n{"actions":[{"type":"tag","tags":["person"]}]}';
      },
    };
    expect(await converseLibrarian(ctx, first, host)).toEqual({
      kind: "reply",
      prose: "Tagging it as a person.",
      actions: [{ type: "tag", tags: ["person"] }],
      vault: [],
      handoff: false,
      raw: 'Tagging it as a person.\n{"actions":[{"type":"tag","tags":["person"]}]}',
    });
    expect(sent.map((message) => message.role)).toEqual(["system", "user"]);
  });
});

describe("applying", () => {
  test("tags and a mark are written and journaled with their before; filing goes last", async () => {
    const { deps, calls } = fakeDeps(view(["tags: [ai]"]));
    const count = await applyLibrarian(
      [
        { type: "file", area: "People", create: true },
        { type: "tag", tags: ["person"] },
        { type: "mark", anchor: { exact: "Maya", prefix: "Met ", suffix: " at" } },
      ],
      { id: "01NOTE", title: "Maya", model: "opus" },
      deps,
    );
    expect(count).toBe(3);
    expect(calls).toEqual([
      "set tags [ai, person]",
      "log tags [ai] -> [ai, person]",
      "learn tags",
      'set anchors [{"exact":"Maya","prefix":"Met ","suffix":" at"}]',
      'log anchors  -> [{"exact":"Maya","prefix":"Met ","suffix":" at"}]',
      "learn anchors",
      "file People",
      "refresh",
    ]);
  });

  test("a tag the note already has writes nothing", async () => {
    const { deps, calls } = fakeDeps(view(["tags: [person]"]));
    expect(
      await applyLibrarian([{ type: "tag", tags: ["Person"] }], { id: "n", title: "", model: "" }, deps),
    ).toBe(0);
    expect(calls).toEqual(["refresh"]);
  });
});
