import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as realBridge from "../lib/finderBridge";
import type { MemexInstance } from "../memex/config";
import * as realActiveVault from "../state/activeVault";
import * as realPersist from "../state/persist";
import { useUiStore } from "../state/ui";

const bridge = { ...realBridge };
const activeVault = { ...realActiveVault };
const persist = { ...realPersist };
let moved = 0;
let refreshed = 0;
let flushed = 0;
void mock.module("../lib/finderBridge", () => ({
  ...bridge,
  corpusAdoptPersonSinks: async () => {
    moved += 1;
    return { archive: 2, trash: 1 };
  },
}));
void mock.module("../state/activeVault", () => ({
  ...activeVault,
  refreshActiveVault: async () => {
    refreshed += 1;
  },
}));
void mock.module("../state/persist", () => ({
  ...persist,
  flushSettingsNow: async () => {
    flushed += 1;
  },
}));
const { answerPersonSinks, personSinksAnswered, personSinksEligible, personSinksQuestion } =
  await import("./personSinks");

afterAll(() => {
  void mock.module("../lib/finderBridge", () => bridge);
  void mock.module("../state/activeVault", () => activeVault);
  void mock.module("../state/persist", () => persist);
});

const copy: MemexInstance = {
  id: "corpus",
  label: "Garden (Rotli)",
  root: "/vaults/Garden (Rotli)",
  role: "corpus",
  memexId: "mx_copy",
  mode: null,
  perms: "chats+inbox",
  brainEnabled: true,
  layout: "imported",
  inPlace: false,
};

describe("the Archive and Trash question", () => {
  beforeEach(() => {
    moved = 0;
    refreshed = 0;
    flushed = 0;
    useUiStore.setState({ personSinksAnswer: null });
  });

  test("is asked only in a copy with the Librarian on, never in place or in a Rotli vault", () => {
    expect(personSinksEligible(copy, null)).toBe(true);
    expect(personSinksEligible({ ...copy, inPlace: true }, null)).toBe(false);
    expect(personSinksEligible({ ...copy, layout: "memex" }, null)).toBe(false);
    expect(personSinksEligible({ ...copy, brainEnabled: false }, null)).toBe(false);
  });

  test("is asked once per vault: a carried answer from another vault doesn't count", () => {
    expect(personSinksAnswered("mx_copy:kept", "mx_copy")).toBe(true);
    expect(personSinksEligible(copy, "mx_copy:moved")).toBe(false);
    expect(personSinksEligible(copy, "mx_other:kept")).toBe(true);
  });

  test("names only the folders the copy has", () => {
    expect(personSinksQuestion({ archive: 3, trash: 2 }).line).toBe(
      "Your vault has its own Archive and Trash folders. Move their notes into Rotli’s Archive and Trash so the Librarian treats them as archived and trashed?",
    );
    expect(personSinksQuestion({ archive: 0, trash: 2 }).title).toBe("Move your Trash?");
  });

  test("No moves nothing and is remembered", async () => {
    await answerPersonSinks("mx_copy", false);
    expect(moved).toBe(0);
    expect(refreshed).toBe(0);
    expect(flushed).toBe(1);
    expect(useUiStore.getState().personSinksAnswer).toBe("mx_copy:kept");
    expect(personSinksEligible(copy, useUiStore.getState().personSinksAnswer)).toBe(false);
  });

  test("Yes saves the answer first, then moves and refreshes", async () => {
    await answerPersonSinks("mx_copy", true);
    expect(useUiStore.getState().personSinksAnswer).toBe("mx_copy:moved");
    expect([flushed, moved, refreshed]).toEqual([1, 1, 1]);
  });
});
