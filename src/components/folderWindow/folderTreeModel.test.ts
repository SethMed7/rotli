import { describe, expect, test } from "bun:test";

import type { Folder, NoteSummary } from "../../types";
import { folderTree } from "./folderTreeModel";

const root = "finder_00ab12cd34ef5678";

function item(id: string, title: string, folderId: string): NoteSummary {
  return {
    id: `${root}:${id}`,
    title,
    folderId,
    snippet: "",
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
  } as NoteSummary;
}

describe("folder window tree", () => {
  test("nests folders under the mount, folders and items each sorted by name", () => {
    const folders: Folder[] = [
      { id: `${root}:Recipes`, name: "Recipes", parentId: null },
      { id: `${root}:Recipes/Soups 10`, name: "Soups 10", parentId: `${root}:Recipes` },
      { id: `${root}:Recipes/Soups 9`, name: "Soups 9", parentId: `${root}:Recipes` },
      { id: `${root}:Archive`, name: "Archive", parentId: null },
    ];
    const tree = folderTree(root, folders, [
      item("b.md", "Lentil stew", `${root}:Recipes`),
      item("a.md", "apple pie", `${root}:Recipes`),
      item("top.md", "Shopping list", `${root}:`),
    ]);
    expect(tree.folders.map((f) => f.name)).toEqual(["Archive", "Recipes"]);
    const recipes = tree.folders[1]!;
    expect(recipes.folders.map((f) => f.name)).toEqual(["Soups 9", "Soups 10"]);
    expect(recipes.items.map((n) => n.title)).toEqual(["apple pie", "Lentil stew"]);
    expect(tree.items.map((n) => n.title)).toEqual(["Shopping list"]);
  });

  test("an item or folder whose parent isn't listed lands at the top, never lost", () => {
    const tree = folderTree(
      root,
      [{ id: `${root}:Deep/Inner`, name: "Inner", parentId: `${root}:Deep` }],
      [item("x.md", "Stray", `${root}:Missing`)],
    );
    expect(tree.folders.map((f) => f.name)).toEqual(["Inner"]);
    expect(tree.items.map((n) => n.title)).toEqual(["Stray"]);
  });
});
