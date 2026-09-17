import { expect, test } from "bun:test";

import { helperReadyFrom } from "./helperLink";

const link = { port: 43111, token: "t".repeat(24) };

test("a pairing is a chat runtime only once proven and while nothing is known to be wrong", () => {
  const settled = { verifying: false };
  expect(helperReadyFrom({ link, reachable: true, problem: null, ...settled })).toBe(true);
  // not checked yet this session (a reload, before boot verifies): NOT ready —
  // a stale token must not open the chat for the moment before the 401 lands
  expect(helperReadyFrom({ link, reachable: null, problem: null, ...settled })).toBe(false);
  // mid-verification: health has answered (reachable true) but the token is
  // not yet proven — a reinstalled helper answers health and refuses the token
  expect(helperReadyFrom({ link, reachable: true, problem: null, verifying: true })).toBe(false);
  expect(helperReadyFrom({ link, reachable: false, problem: null, ...settled })).toBe(false);
  expect(helperReadyFrom({ link, reachable: true, problem: "refused", ...settled })).toBe(false);
  expect(helperReadyFrom({ link, reachable: true, problem: "unreachable", ...settled })).toBe(false);
  expect(helperReadyFrom({ link: null, reachable: true, problem: null, ...settled })).toBe(false);
});
