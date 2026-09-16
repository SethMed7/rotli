import { expect, test } from "bun:test";

import { useCaptureSelection } from "./captureSelection";

test("each Select all request advances the counter the board follows", () => {
  const before = useCaptureSelection.getState().selectAllNonce;
  useCaptureSelection.getState().selectAll();
  useCaptureSelection.getState().selectAll();
  expect(useCaptureSelection.getState().selectAllNonce).toBe(before + 2);
});
