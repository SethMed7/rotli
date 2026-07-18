import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { llmEndpointIsLocal } from "../scripts/config";

// The Breve local-model tier's locality guard is a THIRD independent
// implementation of endpoint locality (alongside src/ai/guard.ts endpointIsLocal
// and Rust chat.rs endpoint_is_local). Parity is held by the shared behavioral
// fixture parity.json → endpointLocality, exactly like the Rust/TS suites.
type Parity = { entries: { endpointLocality: { value: Array<{ url: string; local: boolean }> } } };
const parity: Parity = JSON.parse(
  readFileSync(join(import.meta.dir, "../../scripts/fixtures/parity.json"), "utf8"),
);

describe("breve local-tier endpoint locality — fixture parity", () => {
  test("llmEndpointIsLocal matches the shared endpointLocality verdicts", () => {
    for (const c of parity.entries.endpointLocality.value) {
      expect(llmEndpointIsLocal(c.url), `url: ${c.url}`).toBe(c.local);
    }
  });
});
