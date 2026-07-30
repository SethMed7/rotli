import { describe, expect, test } from "bun:test";
import { noteImageRels, referencedElsewhere } from "./noteLifecycle";

describe("image cascade (images follow their note into Archive/Trash)", () => {
  test("extracts rel image srcs, normalizes storage:, dedupes, skips remote", () => {
    const body = [
      "# Note",
      "![a](storage/pic.png)",
      "![b](storage:shot.png)",
      "![again](storage/pic.png)",
      "![web](https://example.com/x.png)",
      "![inline](data:image/png;base64,xx)",
      "plain [link](storage/doc.pdf) is not an image",
    ].join("\n");
    expect(noteImageRels(body).sort()).toEqual(["storage/pic.png", "storage/shot.png"]);
  });

  test("referencedElsewhere: another note's hit blocks the cascade; own note doesn't", async () => {
    const search = async () => [{ id: "01OTHER" }];
    expect(await referencedElsewhere("storage/pic.png", "01ME", search)).toBe(true);
    const onlyMe = async () => [{ id: "01ME" }];
    expect(await referencedElsewhere("storage/pic.png", "01ME", onlyMe)).toBe(false);
    const nobody = async () => [];
    expect(await referencedElsewhere("storage/pic.png", "01ME", nobody)).toBe(false);
  });

  test("a failed reference check is CONSERVATIVE — counts as referenced", async () => {
    const boom = async () => {
      throw new Error("search down");
    };
    expect(await referencedElsewhere("storage/pic.png", "01ME", boom)).toBe(true);
  });
});
