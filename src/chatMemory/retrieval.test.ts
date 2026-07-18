import { describe, expect, test } from "bun:test";
import { memoryKeywords, mergeKeywordHits, rankChatMemories } from "./retrieval";

describe("master memory retrieval", () => {
  test("extracts inspectable keywords and drops generic question words", () => {
    expect(memoryKeywords("What did we decide about the Cedar launch in past chats?")).toEqual([
      "decide",
      "cedar",
      "launch",
    ]);
  });

  test("ranks title matches before body-only matches and returns chat refs", () => {
    const hits = rankChatMemories(
      [
        { slug: "other", title: "Other", body: "cedar appeared once", modifiedMs: 2 },
        { slug: "cedar", title: "Cedar launch", body: "the July owner decision", modifiedMs: 1 },
      ],
      "cedar launch",
      5,
    );
    expect(hits.map((hit) => hit.id)).toEqual(["chat:cedar", "chat:other"]);
    expect(hits[0]?.source).toBe("chat");
  });

  test("master note search merges phrase and keyword hits without duplicates", () => {
    const hits = mergeKeywordHits([
      [{ id: "phrase", rank: 1, updatedAt: 1 }],
      [
        { id: "title", rank: 0, updatedAt: 1 },
        { id: "phrase", rank: 1, updatedAt: 1 },
      ],
    ]);
    expect(hits.map((hit) => hit.id)).toEqual(["phrase", "title"]);
  });
});
