// The test fake follows Rust's write lane: the same scenarios run against the
// real store in src-tauri/src/corpus_write_lane_tests.rs.
import { expect, test } from "bun:test";

import contract from "../../scripts/fixtures/write-lane-contract.json";
import { fakeLane } from "./writeLane.fixtures";

interface Step {
  op: string;
  note: string;
  body?: string;
  as?: string;
  revision?: string;
  base?: string;
  expect?: string;
  revisionIs?: string;
  revisionNot?: string;
  pinned?: boolean;
  secure?: boolean;
  locked?: boolean;
  missing?: boolean;
  folder?: string;
}

test.each(contract.scenarios.map((s) => [s.name, s.steps as Step[]] as const))("%s", (_name, steps) => {
  const lane = fakeLane();
  const ids = new Map<string, string>();
  const revs = new Map<string, string>();
  const id = (step: Step) => ids.get(step.note)!;
  for (const step of steps) {
    switch (step.op) {
      case "create":
        ids.set(
          step.note,
          lane.create("Inbox", step.body!, { secure: step.secure === true, locked: step.locked === true }).id,
        );
        break;
      case "read": {
        const note = lane.read(id(step));
        if (step.missing) {
          expect(note).toBeNull();
          break;
        }
        if (step.body !== undefined) expect(note!.body).toBe(step.body);
        if (step.revisionIs) expect(note!.revision).toBe(revs.get(step.revisionIs)!);
        if (step.revisionNot) expect(note!.revision).not.toBe(revs.get(step.revisionNot)!);
        if (step.pinned !== undefined) expect(note!.pinned).toBe(step.pinned);
        if (step.secure !== undefined) expect(note!.secure).toBe(step.secure);
        if (step.locked !== undefined) expect(note!.locked).toBe(step.locked);
        if (step.as) revs.set(step.as, note!.revision);
        break;
      }
      case "write": {
        let outcome = "ok";
        try {
          const landed = lane.write(id(step), step.body!, revs.get(step.revision!)!, step.base);
          if (step.as) revs.set(step.as, landed.revision);
        } catch (error) {
          const message = (error as Error).message;
          outcome = message.startsWith("revision conflict")
            ? "conflict"
            : message.startsWith("note not found")
              ? "missing"
              : message;
        }
        expect(outcome).toBe(step.expect!);
        break;
      }
      case "external":
        lane.external(id(step), step.body!);
        break;
      case "pin":
        lane.pin(id(step));
        break;
      case "lock":
        lane.lock(id(step));
        break;
      case "move":
        lane.move(id(step), step.folder!);
        break;
      case "purge":
        lane.purge(id(step));
        break;
      default:
        throw new Error(`unknown step ${step.op}`);
    }
  }
});
