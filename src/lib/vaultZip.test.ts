import { expect, test } from "bun:test";

import JSZip from "jszip";

import { unzipTextFiles, zipTextFiles } from "./vaultZip";

test("a vault export zips every text file under its path and reads back intact", async () => {
  const files = {
    "wiki/_inbox/a.md": "---\nid: A\n---\n# A\n",
    ".rotli/main.json": '{"version":1,"tree":[]}',
    "wiki/projects/deep/b.md": "body with ünïcode\n",
  };
  const blob = await zipTextFiles(files);
  expect(blob.size).toBeGreaterThan(0);
  expect(await unzipTextFiles(blob)).toEqual(files);
});

test("a dropped image rides the zip as its bytes, not as an empty text file", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const blob = await zipTextFiles({ "wiki/a.md": "# A\n" }, { "storage/images/shot.png": bytes });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(new Uint8Array(await zip.file("storage/images/shot.png")!.async("uint8array"))).toEqual(bytes);
  expect(await zip.file("wiki/a.md")!.async("string")).toBe("# A\n");
});
