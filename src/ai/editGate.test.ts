import { expect, test } from "bun:test";

import type { FrontmatterView } from "../lib/tauri";
import { askToEdit, KEPT_AS_IS } from "./editGate";

const fm = (aiBodyEdit: FrontmatterView["aiBodyEdit"], locked = false) =>
  ({ aiBodyEdit, locked, secure: false }) as unknown as FrontmatterView;
const request = { id: "n1", title: "Thought of the day" };

test("a note the person wrote asks them first; each answer does what it says", async () => {
  const granted: string[] = [];
  const grant = async (id: string) => void granted.push(id);
  expect(await askToEdit(fm("person-written"), request, async () => "once", grant)).toEqual({
    block: null,
    consented: true,
  });
  expect(await askToEdit(fm("person-written"), request, async () => "always", grant)).toEqual({
    block: null,
    consented: false,
  });
  expect(granted).toEqual(["n1"]);
  expect(await askToEdit(fm("person-written"), request, async () => "no", grant)).toEqual({
    block: KEPT_AS_IS,
    consented: false,
  });
});

test("a turned-off note can only be turned back on; a lock and an AI-made note never ask", async () => {
  const asked: boolean[] = [];
  const ask = async (r: { revoked: boolean }) => {
    asked.push(r.revoked);
    return "once" as const;
  };
  const grant = async () => undefined;
  // "Allow once" never overrides a deliberate no
  expect((await askToEdit(fm("revoked"), request, ask, grant)).block).toBe(KEPT_AS_IS);
  expect(asked).toEqual([true]);
  const locked = await askToEdit(fm("locked", true), request, ask, grant);
  expect(locked.block).toContain("locked");
  expect((await askToEdit(fm("allowed"), request, ask, grant)).block).toBeNull();
  expect(asked).toEqual([true]);
  // no one to ask (the JSON lanes in a test, the CLI): the refusal stands
  expect((await askToEdit(fm("person-written"), request, undefined, grant)).block).toContain("blocked:");
});
