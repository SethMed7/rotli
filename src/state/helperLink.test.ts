import { expect, test } from "bun:test";

import { helperReadyFrom } from "./helperLink";

const link = { port: 43111, token: "t".repeat(24) };

test("a pairing is a chat runtime only while nothing is known to be wrong", () => {
  expect(helperReadyFrom({ link, reachable: true, problem: null })).toBe(true);
  // not checked yet this session: allowed, the first call decides
  expect(helperReadyFrom({ link, reachable: null, problem: null })).toBe(true);
  expect(helperReadyFrom({ link, reachable: false, problem: null })).toBe(false);
  expect(helperReadyFrom({ link, reachable: true, problem: "refused" })).toBe(false);
  expect(helperReadyFrom({ link, reachable: true, problem: "unreachable" })).toBe(false);
  expect(helperReadyFrom({ link: null, reachable: true, problem: null })).toBe(false);
});
