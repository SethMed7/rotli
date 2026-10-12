import { expect, test } from "bun:test";

import { HelperHttpError, helperConnectionError, helperUnreachable } from "./helperClient";
test("terminal vault errors do not become network outages or CLI tool errors", () => {
  for (const [status, message] of [
    [401, "refused"],
    [404, "unknown command"],
    [409, "vault changed: other"],
    [409, "Rotli Helper isn't serving a vault yet — choose one first."],
  ] as const) {
    const error = new HelperHttpError(message, status);
    expect(helperConnectionError(error, "vault_read")).toBe(true);
    expect(helperConnectionError(error, "cli_complete")).toBe(false);
    expect(helperUnreachable(error)).toBe(false);
  }
  expect(helperConnectionError(new HelperHttpError("revision conflict", 409), "vault_write")).toBe(false);
  expect(helperConnectionError(new HelperHttpError("permission denied", 403), "vault_write")).toBe(false);
  expect(helperConnectionError(new HelperHttpError("no such file: missing.md", 404), "vault_move")).toBe(
    false,
  );
  expect(helperConnectionError(new TypeError("network error"), "vault_write")).toBe(false);
});
