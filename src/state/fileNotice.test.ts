import { expect, test } from "bun:test";

import { dismissFileNotice, showFileNotice, useFileNoticeStore } from "./fileNotice";

test("a file notice shows, and only its own dismissal clears it", () => {
  const first = showFileNotice("Saved to Assets");
  expect(useFileNoticeStore.getState().notice).toEqual({ id: first, message: "Saved to Assets" });
  const second = showFileNotice("Saved 2 files to Assets");
  // the first notice's timer fires late: the newer line must survive it
  dismissFileNotice(first);
  expect(useFileNoticeStore.getState().notice?.message).toBe("Saved 2 files to Assets");
  dismissFileNotice(second);
  expect(useFileNoticeStore.getState().notice).toBeNull();
});
