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
      return () => void calls.push("release");
    }),
    spyOn(activeVault, "refreshActiveVault").mockImplementation(async () => void calls.push("refresh")),
  );
}

test("choosing a folder holds open requests across the switch", async () => {
  const calls: string[] = [];
  record(calls);
  spies.push(
    spyOn(memex, "pickVaultFolder").mockResolvedValue("/tmp/chosen"),
    spyOn(memex, "chooseFolder").mockImplementation(async () => {
      calls.push("switch");
      return true;
    }),
    spyOn(tauri, "corpusInspectFolder").mockResolvedValue({ kind: "markdown" } as tauri.VaultInspection),
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
  expect(calls).toEqual(["hold", "switch", "refresh", "done", "release"]);
});

test("a copy with the Librarian holds them too, and lets go when it fails", async () => {
  const calls: string[] = [];
  record(calls);
  spies.push(
    spyOn(finder, "corpusCopyVault").mockImplementation(async () => {
      calls.push("switch");
      throw new Error("disk full");
    }),
  );
  expect(await copyAndOpen("/tmp/notes", "notes")).toBe(false);
  expect(calls).toEqual(["hold", "switch", "release"]);
});
