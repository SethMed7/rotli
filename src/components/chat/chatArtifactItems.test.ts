import { describe, expect, test } from "bun:test";

import { artifactCaption, artifactType, inlineArtifacts } from "./chatArtifactItems";

// 2026-09-27: a video a chat made showed in the rail as a nameless file.
describe("chat artifact types", () => {
  test("a video is its own type, beside images, documents, notes, and boards", () => {
    const file = (id: string) => artifactType({ kind: "file", id });
    expect(file("storage/chats/demo/clip.mp4")).toBe("video");
    expect(file("storage/chats/demo/clip.MOV")).toBe("video");
    expect(file("storage/chats/demo/chart.png")).toBe("image");
    expect(file("storage/rotli/plan.docx")).toBe("word");
    expect(file("storage/chats/demo/data.bin")).toBe("file");
    expect(artifactType({ kind: "note", id: "01NOTE" })).toBe("note");
    expect(artifactType({ kind: "canvas", id: "storage/excalidraw/plan.excalidraw" })).toBe("board");
  });

  test("a video reads as a video in the rail and is never repeated inline", () => {
    const clip = { kind: "file" as const, id: "storage/chats/demo/clip.mp4" };
    const plan = { kind: "file" as const, id: "storage/rotli/plan.docx" };
    expect(artifactCaption(clip)).toBe("Video · MP4");
    expect(inlineArtifacts([clip, plan])).toEqual([plan]);
  });
});
