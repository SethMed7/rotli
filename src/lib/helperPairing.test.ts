import { describe, expect, test } from "bun:test";

import {
  HELPER_COMMANDS,
  HELPER_DEFAULT_PORT,
  HELPER_VAULT_COMMANDS,
  helperBaseUrl,
  pairingFromHash,
  parsePairingCode,
} from "./helperPairing";

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789";

describe("helper pairing", () => {
  test("the printed code and a loopback link both pair; anything else is refused", () => {
    expect(parsePairingCode(`  43111:${TOKEN}\n`)).toEqual({ port: 43111, token: TOKEN });
    expect(parsePairingCode(`http://127.0.0.1:5000/#${TOKEN}`)).toEqual({ port: 5000, token: TOKEN });
    expect(parsePairingCode(`http://localhost/#${TOKEN}`)).toEqual({
      port: HELPER_DEFAULT_PORT,
      token: TOKEN,
    });
    expect(parsePairingCode(`43111:short`)).toBeNull();
    expect(parsePairingCode(`0:${TOKEN}`)).toBeNull();
    expect(parsePairingCode(`http://evil.example:43111/#${TOKEN}`)).toBeNull();
    expect(parsePairingCode(`${TOKEN}`)).toBeNull();
    expect(parsePairingCode("")).toBeNull();
  });

  test("the helper is only ever addressed on loopback and only for the AI commands", () => {
    expect(helperBaseUrl(43111)).toBe("http://127.0.0.1:43111");
    expect(HELPER_COMMANDS.has("cli_complete")).toBe(true);
    expect(HELPER_COMMANDS.has("model_usage")).toBe(true);
    expect(HELPER_COMMANDS.has("corpus_read")).toBe(false);
  });
});

test("the installer's #pair= fragment carries a code; anything else is ignored", () => {
  const token = "a".repeat(64);
  expect(pairingFromHash(`#pair=43111:${token}`)).toBe(`43111:${token}`);
  expect(pairingFromHash(`#pair=${encodeURIComponent(`43111:${token}`)}`)).toBe(`43111:${token}`);
  expect(pairingFromHash("#pair=nope")).toBeNull();
  expect(pairingFromHash(`#other=43111:${token}`)).toBeNull();
  expect(pairingFromHash("")).toBeNull();
});

test("vault verbs are never AI commands", () => {
  for (const verb of HELPER_VAULT_COMMANDS) expect(HELPER_COMMANDS.has(verb)).toBe(false);
});
