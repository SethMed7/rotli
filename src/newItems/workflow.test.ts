import { describe, expect, test } from "bun:test";

import { createNewItem, type CreatedItem, type CreateNewItemDependencies } from "./workflow";

describe("createNewItem", () => {
  test("presents a durable created item before the structural refresh settles", async () => {
    const calls: string[] = [];
    const item: CreatedItem = { id: "storage/rotli/untitled.docx", kind: "document" };
    let finishRefresh!: () => void;
    const refreshSettled = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const dependencies: CreateNewItemDependencies = {
      creator: { create: async () => (calls.push("create"), item) },
      presenter: {
        refresh: async () => {
          calls.push("refresh:start");
          await refreshSettled;
          calls.push("refresh:done");
        },
        fileInMain: () => void calls.push("main"),
        open: (_item, options) => void calls.push(`open:${options.newTab}`),
      },
    };

    const creation = createNewItem(dependencies, "document", { newTab: true });
    await Promise.resolve();

    expect(calls).toEqual(["create", "open:true", "refresh:start"]);
    finishRefresh();
    expect(await creation).toEqual(item);
    expect(calls).toEqual(["create", "open:true", "refresh:start", "refresh:done", "main"]);
  });

  test("defaults to replacing the active tab while explicit tab creation stays opt-in", async () => {
    const opened: boolean[] = [];
    await createNewItem(
      {
        creator: { create: async () => ({ id: "n", kind: "markdown" }) },
        presenter: {
          refresh: async () => {},
          fileInMain: () => {},
          open: (_item, o) => void opened.push(o.newTab),
        },
      },
      "markdown",
    );
    expect(opened).toEqual([false]);
  });

  test("embedded creation keeps the parent Markdown tab active", async () => {
    const calls: string[] = [];
    await createNewItem(
      {
        creator: { create: async () => ({ id: "storage/rotli/embed.xlsx", kind: "sheet" }) },
        presenter: {
          refresh: async () => void calls.push("refresh"),
          fileInMain: () => void calls.push("main"),
          open: () => void calls.push("open"),
        },
      },
      "sheet",
      { open: false },
    );
    expect(calls).toEqual(["refresh", "main"]);
  });
});
