import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { welcomeBodyHash, withCurrentBodies } from "./welcome-history.mjs";

const catalog: { id: string; body: string }[] = JSON.parse(readFileSync("src/assets/welcome.json", "utf8"));
const history: Record<string, string[]> = JSON.parse(readFileSync("src/assets/welcome-history.json", "utf8"));

test("every current Welcome body is recorded — run `bun scripts/welcome-history.mjs` after editing welcome.json", () => {
  const missing = catalog.filter((entry) => !(history[entry.id] ?? []).includes(welcomeBodyHash(entry.body)));
  expect(missing.map((entry) => entry.id)).toEqual([]);
});

test("recording is append-only and ignores line-ending and trailing-newline noise", () => {
  expect(welcomeBodyHash("# A\r\nb\n\n")).toBe(welcomeBodyHash("# A\nb"));
  const first = withCurrentBodies({}, [{ id: "a", body: "# A\nold\n" }]);
  const second = withCurrentBodies(first, [{ id: "a", body: "# A\nnew\n" }]);
  expect(second.a).toEqual([welcomeBodyHash("# A\nold"), welcomeBodyHash("# A\nnew")]);
  expect(withCurrentBodies(second, [{ id: "a", body: "# A\nnew" }])).toEqual(second);
});
