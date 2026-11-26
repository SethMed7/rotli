// Both ways a setup screen switches vaults hold the `rotli open` mailbox
// (state/openRequestGate.ts) from before the switch until the new vault has
// been rebuilt: the mailbox moves with the vault.

import { afterEach, expect, spyOn, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import * as finder from "../../lib/finderBridge";
import * as tauri from "../../lib/tauri";
import * as memex from "../../memex/service";
import { copyAndOpen } from "../../services/vaultImport";
import * as activeVault from "../../state/activeVault";
import { openRequestGate } from "../../state/openRequestGate";
import * as persist from "../../state/persist";
import { useVaultChoice } from "./vaultActivation";

const spies: { mockRestore: () => void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function record(calls: string[]) {
  spies.push(
    spyOn(openRequestGate, "holdForSwitch").mockImplementation(async () => {
      calls.push("hold");
      return (moved: boolean) => void calls.push(moved ? "release:moved" : "release:stayed");
    }),
    spyOn(activeVault, "refreshActiveVault").mockImplementation(async () => void calls.push("refresh")),
  );
}

/** Pick a folder on setup's vault step; `switchVault` is what the switch does. */
async function chooseAFolder(calls: string[], switchVault: () => Promise<boolean>) {
  record(calls);
  spies.push(
    spyOn(memex, "pickVaultFolder").mockResolvedValue("/tmp/chosen"),
    spyOn(memex, "chooseFolder").mockImplementation(async () => {
      calls.push("switch");
      return switchVault();
    }),
    spyOn(tauri, "corpusInspectFolder").mockResolvedValue({ kind: "markdown" } as tauri.VaultInspection),
    spyOn(tauri, "corpusStatus").mockResolvedValue(true),
    spyOn(persist, "flushSettingsNow").mockResolvedValue(),
  );
  const probed: (() => Promise<void>)[] = [];
  function Probe({ report }: { report: (choose: () => Promise<void>) => void }) {
    report(
      useVaultChoice({
        librarian: () => false,
        onDone: () => void calls.push("done"),
      }).choose,
    );
    return null;
  }
  renderToStaticMarkup(<Probe report={(choose) => probed.push(choose)} />);
  await probed[0]!();
}

test("choosing a folder holds open requests across the switch", async () => {
  const calls: string[] = [];
  await chooseAFolder(calls, async () => true);
  expect(calls).toEqual(["hold", "switch", "refresh", "done", "release:moved"]);
});

test("a switch that fails, or finds that vault already open, says the vault stayed", async () => {
  const failed: string[] = [];
  await chooseAFolder(failed, async () => {
    throw new Error("can't open that folder");
  });
  expect(failed).toEqual(["hold", "switch", "release:stayed"]);

  for (const spy of spies.splice(0)) spy.mockRestore();
  const same: string[] = [];
  await chooseAFolder(same, async () => false);
  expect(same).toEqual(["hold", "switch", "done", "release:stayed"]);
});

test("a copy with the Librarian holds them too, and says whether the copy opened", async () => {
  const calls: string[] = [];
  record(calls);
  let full = true;
  spies.push(
    spyOn(finder, "corpusCopyVault").mockImplementation(async () => {
      calls.push("switch");
      if (full) throw new Error("disk full");
      return {} as finder.VaultCopyReport;
    }),
  );
  expect(await copyAndOpen("/tmp/notes", "notes")).toBe(false);
  expect(calls).toEqual(["hold", "switch", "release:stayed"]);

  calls.length = 0;
  full = false;
  expect(await copyAndOpen("/tmp/notes", "notes")).toBe(true);
  expect(calls).toEqual(["hold", "switch", "refresh", "release:moved"]);
});
