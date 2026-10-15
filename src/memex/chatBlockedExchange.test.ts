import { expect, test } from "bun:test";

import { withoutTrailingBlockedExchange } from "./service";

const head = "---\ntitle: T\n---\n\n# T\n\n## Messages\n";

test("a held-back exchange is taken off the end of the chat file, and nothing else is", () => {
  const kept = `${head}**you** · 2026-10-15T10:00:00Z — hi\n**rotli** · 2026-10-15T10:00:05Z — hello\n`;
  const blocked = `${kept}**you** · 2026-10-15T10:01:00Z — my long\nmulti-line message\n**rotli** · 2026-10-15T10:01:01Z — ⚠ Held back: this message has text shaped like a password\n`;
  expect(withoutTrailingBlockedExchange(blocked)).toBe(kept);
  // an ordinary reply at the end is left alone
  expect(withoutTrailingBlockedExchange(kept)).toBe(kept);
});
