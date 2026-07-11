import { describe, expect, test } from "bun:test";
import { createNewItem, type CreatedItem, type CreateNewItemDependencies } from "./workflow";

describe("createNewItem", () => {
  test("creates, refreshes, files in Main, then opens in one ordered workflow", async () => {
    const calls: string[] = [];
    const item: CreatedItem = { id: "storage/rotli/untitled.docx", kind: "document" };
    const dependencies: CreateNewItemDependencies = {
      creator: { create: async () => (calls.push("create"), item) },
      presenter: {
        refresh: async () => void calls.push("refresh"),
        fileInMain: () => void calls.push("main"),
        open: (_item, options) => void calls.push(`open:${options.newTab}`),
      },
    };

    expect(await createNewItem(dependencies, "document", { newTab: true })).toEqual(item);
    expect(calls).toEqual(["create", "refresh", "main", "open:true"]);
  });

  test("defaults to replacing the active tab while explicit tab creation stays opt-in", async () => {
    const opened: boolean[] = [];
    await createNewItem(
      {
        creator: { create: async () => ({ id: "n", kind: "markdown" }) },
        presenter: { refresh: async () => {}, fileInMain: () => {}, open: (_item, o) => void opened.push(o.newTab) },
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
