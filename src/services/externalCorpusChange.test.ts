import { describe, expect, test } from "bun:test";

import { refreshAfterExternalCorpusChange } from "./externalCorpusChange";

describe("external corpus refresh", () => {
  test("refreshes chats and chat folders along with the note projections", async () => {
    const called: string[] = [];
    const mark =
      (name: string, fail = false) =>
      () => {
        called.push(name);
        if (fail) throw new Error("one projection is malformed");
      };

    await refreshAfterExternalCorpusChange({
      folders: mark("folders"),
      notes: mark("notes", true),
      chats: mark("chats"),
      chatFolders: mark("chatFolders"),
      main: mark("main"),
      views: mark("views"),
      journal: mark("journal"),
    });

    expect(called).toEqual(["folders", "notes", "chats", "chatFolders", "main", "views", "journal"]);
  });
});
