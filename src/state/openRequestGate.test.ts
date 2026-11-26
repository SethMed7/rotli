// A `rotli open` that arrives while a setup screen shows is held until setup
// ends: the app used to take it off disk at once, and setup's vault switch
// then dropped the tab it had opened, so the request was gone.

import { describe, expect, test } from "bun:test";

import type { WorkspaceOpenRequest } from "../lib/tauri";
import { createOpenRequestGate } from "./openRequestGate";

const note = (id: string): WorkspaceOpenRequest => ({ id, kind: "note" });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Vaults with a one-slot mailbox each, and the tabs of the live one. A vault
 * switch moves the mailbox the app reads and clears the tabs. */
function world() {
  const mailboxes = new Map<string, WorkspaceOpenRequest>();
  const tabs: string[] = [];
  let vault = "first";
  const take = async () => {
    const request = mailboxes.get(vault) ?? null;
    mailboxes.delete(vault);
    return request;
  };
  return {
    tabs,
    take,
    deliver: (request: WorkspaceOpenRequest) => void tabs.push(`${vault}/${request.id}`),
    /** `rotli open` writes into the live vault's mailbox, newest wins. */
    queue: (id: string) => void mailboxes.set(vault, note(id)),
    onDisk: (name: string) => mailboxes.get(name)?.id ?? null,
    switchTo: (name: string) => {
      vault = name;
      tabs.length = 0;
    },
  };
}

/** A launch that shows setup. */
async function inSetup(disk: ReturnType<typeof world>) {
  const gate = createOpenRequestGate(disk.take);
  gate.attach(disk.deliver);
  await gate.setSetupShown(true);
  return gate;
}

describe("a request that arrives during setup", () => {
  test("stays on disk until setup ends, then opens in the vault setup kept", async () => {
    const disk = world();
    disk.queue("plan");
    const gate = await inSetup(disk);
    await gate.consume(); // the nudge
    expect(disk.tabs).toEqual([]);
    expect(disk.onDisk("first")).toBe("plan");

    await gate.setSetupShown(false);
    expect(disk.tabs).toEqual(["first/plan"]);
    expect(disk.onDisk("first")).toBeNull();
  });

  test("queued before setup switches vaults, it survives and opens in the new one", async () => {
    const disk = world();
    disk.queue("plan");
    const gate = await inSetup(disk);

    const release = await gate.holdForSwitch();
    // taken before the switch: it can't be left to fire from the old vault later
    expect(disk.onDisk("first")).toBeNull();
    disk.switchTo("chosen");
    release();
    await gate.consume();
    expect(disk.tabs).toEqual([]);

    await gate.setSetupShown(false);
    expect(disk.tabs).toEqual(["chosen/plan"]);
  });

  test("a newer request queued in the chosen vault wins over the held one", async () => {
    const disk = world();
    disk.queue("older");
    const gate = await inSetup(disk);
    const release = await gate.holdForSwitch();
    disk.switchTo("chosen");
    release();
    disk.queue("newer");
    await gate.consume();

    await gate.setSetupShown(false);
    expect(disk.tabs).toEqual(["chosen/newer"]);
  });

  test("a switch that fails keeps holding, and Skip setup delivers it", async () => {
    const disk = world();
    disk.queue("plan");
    const gate = await inSetup(disk);
    const release = await gate.holdForSwitch();
    release(); // the switch threw: still the first vault, still on setup's screen
    await gate.consume();
    expect(disk.tabs).toEqual([]);

    await gate.setSetupShown(false);
    expect(disk.tabs).toEqual(["first/plan"]);
  });

  test("quitting mid-setup leaves it on disk for the next launch's setup", async () => {
    const disk = world();
    disk.queue("plan");
    const first = await inSetup(disk);
    await first.consume();
    expect(disk.onDisk("first")).toBe("plan");

    const relaunch = await inSetup(disk);
    expect(disk.tabs).toEqual([]);
    await relaunch.setSetupShown(false);
    expect(disk.tabs).toEqual(["first/plan"]);
  });

  test("a vault screen that closes mid-switch delivers only once the switch is done", async () => {
    // outside onboarding the screen leaves as soon as the new vault reads as
    // configured, while its panes are still being rebuilt
    const disk = world();
    disk.queue("plan");
    const gate = await inSetup(disk);
    const release = await gate.holdForSwitch();
    disk.switchTo("chosen");
    await gate.setSetupShown(false);
    expect(disk.tabs).toEqual([]);

    release();
    await gate.consume();
    expect(disk.tabs).toEqual(["chosen/plan"]);
  });
});

describe("outside setup", () => {
  test("a request opens at once, at launch and on every nudge", async () => {
    const disk = world();
    disk.queue("at-launch");
    const gate = createOpenRequestGate(disk.take);
    gate.attach(disk.deliver);
    await gate.setSetupShown(false);
    disk.queue("nudged");
    await gate.consume();
    expect(disk.tabs).toEqual(["first/at-launch", "first/nudged"]);
  });

  test("a vault switch from Settings takes nothing", async () => {
    const disk = world();
    const gate = createOpenRequestGate(disk.take);
    gate.attach(disk.deliver);
    await gate.setSetupShown(false);
    disk.queue("plan");
    const release = await gate.holdForSwitch();
    expect(disk.onDisk("first")).toBe("plan");
    release();
  });

  test("nothing is taken before the window knows whether setup shows", async () => {
    const disk = world();
    disk.queue("plan");
    const gate = createOpenRequestGate(disk.take);
    gate.attach(disk.deliver);
    await gate.consume();
    expect(disk.onDisk("first")).toBe("plan");
  });

  test("a read that finishes after setup appeared is held, not dropped", async () => {
    const disk = world();
    let finishRead = () => {};
    const slow = new Promise<void>((resolve) => (finishRead = resolve));
    const gate = createOpenRequestGate(async () => {
      const request = await disk.take();
      await slow;
      return request;
    });
    gate.attach(disk.deliver);
    disk.queue("plan");
    const reading = gate.setSetupShown(false);
    await tick(); // the request is off disk, the read not yet back
    const shown = gate.setSetupShown(true);
    finishRead();
    await Promise.all([reading, shown]);
    expect(disk.tabs).toEqual([]);

    await gate.setSetupShown(false);
    expect(disk.tabs).toEqual(["first/plan"]);
  });

  test("a read that finishes after the workspace detached is kept for the next one", async () => {
    const disk = world();
    let finishRead = () => {};
    const slow = new Promise<void>((resolve) => (finishRead = resolve));
    const gate = createOpenRequestGate(async () => {
      const request = await disk.take();
      await slow;
      return request;
    });
    disk.queue("plan");
    const detach = gate.attach(disk.deliver);
    const reading = gate.setSetupShown(false);
    await tick(); // the request is off disk, the read not yet back
    detach(); // React's double-mounted effect, or the shell remounting
    finishRead();
    await reading;
    expect(disk.tabs).toEqual([]);
    gate.attach(disk.deliver);
    await gate.consume();
    expect(disk.tabs).toEqual(["first/plan"]);
  });
});
