import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  APP_IDENTIFIER,
  OWNS_SHARED_STATE,
  STANDALONE_IDENTIFIER,
  bundleIdentifier,
  identityHolds,
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

test("the front end starts only under the app it was built for", async () => {
  expect(await identityHolds(HOST, async () => HOST)).toBe(true);
  expect(await identityHolds(STANDALONE_IDENTIFIER, async () => STANDALONE_IDENTIFIER)).toBe(true);
  // a host bundle whose Vite config forgot the define reads as standalone: stop
  expect(await identityHolds(STANDALONE_IDENTIFIER, async () => HOST)).toBe(false);
  expect(await identityHolds(HOST, async () => STANDALONE_IDENTIFIER)).toBe(false);
  // a runtime that can't say which app it is doesn't get the app either
  expect(
    await identityHolds(HOST, async () => {
      throw new Error("no IPC");
    }),
  ).toBe(false);
});

test("the desktop app checks its identity before it renders anything", () => {
  const main = read("src/main.tsx");
  const check = main.indexOf("identityHolds(");
  expect(check).toBeGreaterThan(-1);
  expect(check).toBeLessThan(main.indexOf("ReactDOM.createRoot("));
});
