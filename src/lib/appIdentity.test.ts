import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  APP_IDENTIFIER,
  EXISTING_VAULT_REFUSAL,
  OWNS_SHARED_STATE,
  STANDALONE_IDENTIFIER,
  bundleIdentifier,
  existingVaultRefusal,
  ownsSharedStateFor,
} from "./appIdentity";

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const HOST = "com.example.host";

test("this test run is the standalone build", () => {
  expect(APP_IDENTIFIER).toBe(STANDALONE_IDENTIFIER);
  expect(OWNS_SHARED_STATE).toBe(true);
});

test("the identifier is read by one rule: named, then the Tauri overlay, then tauri.conf.json", () => {
  const base = read("src-tauri/tauri.conf.json");
  expect(bundleIdentifier(undefined, undefined, base)).toBe(STANDALONE_IDENTIFIER);
  // the dev overlay names no identifier, so the dev app stays the standalone one
  expect(bundleIdentifier(undefined, read("src-tauri/tauri.dev.conf.json"), base)).toBe(
    STANDALONE_IDENTIFIER,
  );
  expect(bundleIdentifier(undefined, JSON.stringify({ identifier: HOST }), base)).toBe(HOST);
  expect(bundleIdentifier(HOST, JSON.stringify({ identifier: "com.example.other" }), base)).toBe(HOST);
  expect(bundleIdentifier("", "not json", base)).toBe(STANDALONE_IDENTIFIER);
  expect(() => bundleIdentifier(undefined, undefined, "{}")).toThrow();
  expect(() => bundleIdentifier("com.example/../x", undefined, base)).toThrow();
});

test("only the standalone identifier owns shared state; any other fails closed", () => {
  expect(ownsSharedStateFor(STANDALONE_IDENTIFIER)).toBe(true);
  const others = [HOST, "com.rotli.app.preview", " com.rotli.app", "com.rotli"];
  expect(others.filter(ownsSharedStateFor)).toEqual([]);
});

test("a host identity refuses a folder Rotli already uses; the standalone one refuses nothing", () => {
  expect(existingVaultRefusal(HOST, { kind: "memex" })).toBe(EXISTING_VAULT_REFUSAL);
  expect(existingVaultRefusal(HOST, { kind: "memex" }, "Host words.")).toBe("Host words.");
  expect(existingVaultRefusal(HOST, { kind: "markdown" })).toBeNull();
  expect(existingVaultRefusal(HOST, { kind: "empty" })).toBeNull();
  expect(existingVaultRefusal(STANDALONE_IDENTIFIER, { kind: "memex" })).toBeNull();
});
