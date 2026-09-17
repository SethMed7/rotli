import { describe, expect, test } from "bun:test";

import { dropTargetKey, sidebarDropTargetAt, SpringOpen } from "./sidebarDropTargets";

/** An element whose ancestors carry the given attributes and classes
 * (`class` lists the row classes, space-separated). */
function el(attrs: Record<string, string>) {
  const classes = (attrs["class"] ?? "").split(" ").filter(Boolean);
  const node = {
    closest: (selector: string) => {
      const cls = /^\.([\w-]+)/.exec(selector)?.[1];
      const name = /\[([\w-]+)\]/.exec(selector)?.[1] ?? "";
      const classOk = !cls || classes.includes(cls);
      return classOk && name in attrs ? node : null;
    },
    getAttribute: (name: string) => attrs[name] ?? null,
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  return node;
}

describe("sidebarDropTargetAt", () => {
  test("a chat row and a Main note row are targets; anything else is not", () => {
    expect(
      sidebarDropTargetAt(el({ class: "sb-chatrow", "data-chat-slug": "omachary-research" })),
    ).toMatchObject({ kind: "chat", slug: "omachary-research" });
    expect(sidebarDropTargetAt(el({ class: "snrow main-row", "data-note-id": "01NOTE" }))).toMatchObject({
      kind: "note",
      id: "01NOTE",
    });
    expect(sidebarDropTargetAt(el({ "data-main-id": "main:" }))).toBeNull();
    expect(sidebarDropTargetAt(null)).toBeNull();
  });

  test("only SIDEBAR rows count: an All-notes row or a Library tile with data-note-id does not", () => {
    expect(sidebarDropTargetAt(el({ class: "note-row", "data-note-id": "01NOTE" }))).toBeNull();
    expect(sidebarDropTargetAt(el({ class: "fdr-tile", "data-note-id": "01NOTE" }))).toBeNull();
    // the "All chats" row has the class but no slug
    expect(sidebarDropTargetAt(el({ class: "sb-chatrow all" }))).toBeNull();
  });

  test("a chat row wins over a note ancestor, and keys are stable per row", () => {
    const target = sidebarDropTargetAt(
      el({ class: "sb-chatrow", "data-chat-slug": "c", "data-note-id": "n" }),
    );
    expect(target).toMatchObject({ kind: "chat", slug: "c" });
    expect(dropTargetKey(target!)).toBe("chat:c");
    expect(dropTargetKey(sidebarDropTargetAt(el({ class: "main-row", "data-note-id": "n" }))!)).toBe(
      "note:n",
    );
  });
});

describe("SpringOpen", () => {
  /** A hand-driven clock: `fire()` runs whatever is pending. */
  function clock() {
    const pending: { run: () => void; ms: number; cancelled: boolean }[] = [];
    return {
      pending,
      schedule: (run: () => void, ms: number) => {
        const entry = { run, ms, cancelled: false };
        pending.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
      fire() {
        for (const entry of pending.splice(0)) if (!entry.cancelled) entry.run();
      },
    };
  }

  test("holding over the same row opens it once after the dwell", () => {
    const c = clock();
    const spring = new SpringOpen(550, c.schedule);
    let opened = 0;
    spring.hover("note:a", () => opened++);
    spring.hover("note:a", () => opened++);
    spring.hover("note:a", () => opened++);
    expect(c.pending).toHaveLength(1);
    expect(c.pending[0]?.ms).toBe(550);
    c.fire();
    expect(opened).toBe(1);
  });

  test("moving to another row restarts the dwell; leaving cancels it", () => {
    const c = clock();
    const spring = new SpringOpen(550, c.schedule);
    const opened: string[] = [];
    spring.hover("note:a", () => opened.push("a"));
    spring.hover("note:b", () => opened.push("b"));
    c.fire();
    expect(opened).toEqual(["b"]);
    spring.hover("note:c", () => opened.push("c"));
    spring.leave();
    c.fire();
    expect(opened).toEqual(["b"]);
  });
});
