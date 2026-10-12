import { expect, test } from "bun:test";

import { kindOf } from "./fileSurfaceKinds";

test("asset summaries route to the conventional file viewer", () => {
  for (const [name, kind] of [
    ["picture.PNG", "image"],
    ["clip.webm", "video"],
    ["recording.opus", "audio"],
    ["reference.pdf", "pdf"],
    ["measurements.csv", "sheet"],
    ["export.xlsx", "sheet"],
    ["letter.docx", "document"],
    ["offline-doc.html", "html"],
    ["plain.txt", "text"],
    ["bundle.bin", "other"],
  ] as const)
    expect(kindOf(name!)).toBe(kind);
});
