import { expect, test } from "bun:test";

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
