import { describe, expect, test } from "bun:test";

import { missingScriptSteps, missingTokens, unreferencedNames } from "./documentation-contract.mjs";

describe("documentation contract helpers", () => {
  test("reports every missing guidance token", () => {
    expect(missingTokens("AGENTS.md routes the work", ["AGENTS.md", "docs/README.md", "SYNTAX.md"])).toEqual([
      "docs/README.md",
      "SYNTAX.md",
    ]);
  });

  test("reports missing steps from named package chains", () => {
    expect(
      missingScriptSteps(
        { check: "bun run lint", lint: "tsc --noEmit && bun run format:check" },
        {
          check: ["bun run lint", "bun run test:regression"],
          lint: ["tsc --noEmit", "bun run format:check"],
        },
      ),
    ).toEqual(["check -> bun run test:regression"]);
  });

  test("recognizes named scripts inside Bun's parallel runner", () => {
    expect(
      missingScriptSteps(
        { lint: "bun run --parallel typecheck format:check lint:oxlint" },
        { lint: ["bun run typecheck", "bun run format:check", "bun run lint:oxlint"] },
      ),
    ).toEqual([]);
  });

  test("reports names no runner mentions", () => {
    expect(
      unreferencedNames(
        ["test-actions.ts", "test-intents.ts", "test-new.ts"],
        "bun breve-runtime/tests/test-actions.ts && bun breve-runtime/tests/test-intents.ts",
      ),
    ).toEqual(["test-new.ts"]);
  });

  test("keeps a deliberately manual name out of the orphan list", () => {
    expect(
      unreferencedNames(["eval-local-chat.ts", "stray.ts"], "", {
        "eval-local-chat.ts": "LIVE eval — run by hand",
      }),
    ).toEqual(["stray.ts"]);
  });
});
