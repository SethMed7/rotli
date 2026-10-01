import { expect, test } from "bun:test";

import {
  MAX_PINS,
  newStore,
  PIN_PROBLEMS,
  parsePinnedSites,
  pinLabel,
  pinMark,
  pinnedUrl,
  pinProblem,
  withPin,
} from "./pinnedSites";

const counting = () => {
  let n = 0;
  return (bytes: Uint8Array<ArrayBuffer>) => bytes.map(() => ++n % 256);
};

test("a pin's address is https only; a bare host becomes https", () => {
  expect(pinnedUrl("x.com/home")).toBe("https://x.com/home");
  expect(pinnedUrl(" https://mail.proton.me ")).toBe("https://mail.proton.me/");
  for (const bad of [
    "",
    "http://x.com",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "localhost",
    "https://u:p@x.com",
  ])
    expect(pinnedUrl(bad)).toBeNull();
});

test("a pin's name is the person's or the host; its mark is one letter", () => {
  expect(pinLabel("  My   X ", "https://x.com/")).toBe("My X");
  expect(pinLabel("", "https://www.github.com/")).toBe("github.com");
  expect(pinMark("x.com")).toBe("X");
  expect(pinMark("✨ Ideas")).toBe("I");
  expect(pinMark("✨")).toBe("•");
});

test("a store is 16 random bytes in hex, never all zero", () => {
  expect(newStore(counting())).toBe("0102030405060708090a0b0c0d0e0f10");
  let calls = 0;
  const zeroFirst = (bytes: Uint8Array<ArrayBuffer>) => (++calls === 1 ? bytes : bytes.fill(7));
  expect(newStore(zeroFirst)).toBe("07".repeat(16));
});

test("up to three pins, one per site, each in the lowest free slot", () => {
  let sites = withPin([], "X", "x.com", counting())!;
  sites = withPin(sites, "", "https://github.com", counting())!;
  expect(sites.map((site) => [site.slot, site.label])).toEqual([
    [0, "X"],
    [1, "github.com"],
  ]);
  expect(pinProblem("https://x.com/other", sites)).toBe(PIN_PROBLEMS.pinned);
  expect(pinProblem("http://y.com", sites)).toBe(PIN_PROBLEMS.notHttps);
  // removing the first frees slot 0 for the next pin
  const next = withPin(sites.slice(1), "Proton", "mail.proton.me", counting())!;
  expect(next.find((site) => site.label === "Proton")?.slot).toBe(0);
  const full = withPin(next, "Y", "y.com", counting())!;
  expect(full).toHaveLength(MAX_PINS);
  expect(pinProblem("z.com", full)).toMatch(/remove one first/);
});

test("saved pins are checked again: a bad address, store, slot, or duplicate drops", () => {
  const ok = { slot: 0, label: "X", url: "https://x.com/", store: "0102030405060708090a0b0c0d0e0f10" };
  const parsed = parsePinnedSites([
    ok,
    { ...ok, slot: 1 }, // same store
    { ...ok, slot: 2, url: "http://x.com/", store: "1".repeat(32) },
    { ...ok, slot: 2, store: "0".repeat(32) },
    { ...ok, slot: 9, store: "2".repeat(32) },
    { ...ok, slot: 1, store: "4".repeat(32), url: "https://x.com/messages" }, // same origin, hand-edited
    { ...ok, slot: 2, store: "3".repeat(32), url: "https://github.com", label: "" },
    "junk",
  ]);
  expect(parsed.map((site) => [site.slot, site.label, site.url])).toEqual([
    [0, "X", "https://x.com/"],
    [2, "github.com", "https://github.com/"],
  ]);
  expect(parsed[0]?.id).toBe("pin-010203040506");
  expect(parsePinnedSites("nope")).toEqual([]);
});
