#!/usr/bin/env bun
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateAction } from "../scripts/actions";

const root = join(import.meta.dir, ".action-fixture");
mkdirSync(join(root, "scripts"), { recursive: true });
writeFileSync(join(root, "scripts/ok.sh"), "#!/bin/bash\nexit 0\n");
let failures = 0;
const expect = async (label: string, action: unknown, valid: boolean, phrase = "") => {
  const result = await validateAction(root, action);
  const pass = valid ? result === null : !!result?.toLowerCase().includes(phrase.toLowerCase());
  if (!pass) { failures++; console.error(`FAIL ${label}: ${result}`); }
};

await expect("known script", { action: "run-script", script: "ok.sh", args: ["--test"] }, true);
await expect("path traversal", { action: "run-script", script: "../x" }, false, "plain filename");
await expect("shell-shaped arg", { action: "run-script", script: "ok.sh", args: [";rm"] }, false, "simple");
await expect("legacy install rejected", { action: "install-launchd", plist: "com.example.breve-x.plist" }, false, "Rotli owns");
await expect("legacy uninstall rejected", { action: "uninstall-launchd", label: "com.example.breve-x" }, false, "Rotli owns");
rmSync(root, { recursive: true, force: true });
if (failures) process.exit(1);
console.log("Breve action boundary ok");
