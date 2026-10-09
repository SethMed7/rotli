import { expect, test } from "bun:test";

import { PROVIDER_IDS } from "../ai/models";
import { checkLibrarianLane, providerReady, startSetupDetection, useSetupDetection } from "./setupDetection";

test("a client counts as ready only when installed AND signed in", () => {
  expect(providerReady(undefined)).toBe(false);
  expect(providerReady({ installed: true, authenticated: false, version: "1" })).toBe(false);
  expect(providerReady({ installed: false, authenticated: true, version: null })).toBe(false);
  expect(providerReady({ installed: true, authenticated: true, version: "1" })).toBe(true);
});

// before the full start below: the sidebar's Librarian asks about its own lane only
test("the Librarian's lane is asked about alone, and the local list says when it has answered", async () => {
  expect(useSetupDetection.getState().localChecked).toBe(false);
  checkLibrarianLane("claude");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(Object.keys(useSetupDetection.getState().detections)).toEqual(["claude"]);
  expect(useSetupDetection.getState().localChecked).toBe(false);
  checkLibrarianLane("local");
  await new Promise((resolve) => setTimeout(resolve, 20));
  // outside the shell the list fails, which still counts as answered: none
  expect(useSetupDetection.getState().localChecked).toBe(true);
  expect(useSetupDetection.getState().local).toEqual([]);
});

test("detection starts once and, outside the shell, settles every lane to not installed", async () => {
  startSetupDetection();
  startSetupDetection();
  expect(useSetupDetection.getState().started).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { detections, local } = useSetupDetection.getState();
  for (const provider of PROVIDER_IDS) {
    expect(detections[provider]).toEqual({ installed: false, authenticated: false, version: null });
  }
  expect(local).toEqual([]);
});
