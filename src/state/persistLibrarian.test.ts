// The Librarian lane and model knobs through the settings parser: connected
// clients survive, everything else fails closed, and a model id sticks only
// inside its lane's catalog.

import { expect, test } from "bun:test";

import { parseSettings } from "./persist";

test("the Librarian lane keeps the connected clients and fails closed on everything else", () => {
  const lane = (id: string) => parseSettings(`{"organizerModel":"${id}"}`).organizerModel;
  expect(["claude", "antigravity"].map(lane)).toEqual(["claude", "antigravity"]);
  expect(["gemini35", "cursor", "future"].map(lane)).toEqual(["local", "local", "local"]);
});

test("a Librarian model id is kept only when its lane's catalog lists it", () => {
  const id = (raw: string) => parseSettings(raw).organizerModelId;
  expect(id('{"organizerModel":"claude","organizerModelId":"opus"}')).toBe("opus");
  expect(id('{"organizerModel":"claude","organizerModelId":"gemini-3.8-flash-high"}')).toBeNull();
  expect(id('{"organizerModel":"local","organizerModelId":"opus"}')).toBeNull();
  expect(id("{}")).toBeNull();
});
