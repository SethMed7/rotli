import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(name)) {
      const rel = relative(root, path);
      if (name === "vite-env.d.ts") continue; // Vite's conventional generated declaration
      const stem = basename(name).split(".")[0];
      if (!/^[a-z][A-Za-z0-9]*$/.test(stem)) {
        violations.push(`${rel}: source filenames must be camelCase`);
      }
    }
  }
}
walk(join(root, "src"));

const deniedDependencies = [
  "better-sqlite3",
  "dexie",
  "diesel",
  "pouchdb",
  "prisma",
  "rusqlite",
  "sqlx",
  "sqlite",
  "sqlite3",
];
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const jsDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const dependency of deniedDependencies) {
  if (dependency in jsDependencies) violations.push(`package.json: database dependency ${dependency}`);
}
const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
for (const dependency of deniedDependencies) {
  if (new RegExp(`^${dependency}\\s*=`, "m").test(cargo)) {
    violations.push(`src-tauri/Cargo.toml: database dependency ${dependency}`);
  }
}

if (violations.length) {
  console.error(`structure check failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log("check:structure ok — camelCase source files; no database dependency");
