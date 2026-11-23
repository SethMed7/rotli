// A synthetic memex vault shaped like a long-lived one, for timing `rotli notes list`:
// a few hundred wiki notes across nested folders, a storage/ asset store of thousands of
// binary files, and a large .rotli/ projection folder. Every byte is random or generated.
//
//   bun run perf:notes-list-vault "<empty folder>" [notes=400] [storageFiles=4000] [storageKiB=64]
//   ROTLI_CORPUS_ROOT="<that folder>" rotli notes list > /dev/null
//
// It only writes into an empty or missing folder, so it can never touch a real vault.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [target, notesArg, filesArg, kibArg] = process.argv.slice(2);
if (!target)
  throw new Error(
    'Usage: bun scripts/perf-notes-list-vault.mjs "<empty folder>" [notes] [storageFiles] [storageKiB]',
  );
const root = resolve(target);
if ((await readdir(root).catch(() => [])).length > 0)
  throw new Error(`${root} is not empty; pick a new folder`);
const noteCount = Number(notesArg ?? 400);
const fileCount = Number(filesArg ?? 4000);
const fileBytes = Number(kibArg ?? 64) * 1024;

async function put(rel, data, ageDays) {
  const path = join(root, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, data);
  const when = new Date(Date.now() - ageDays * 86_400_000);
  await utimes(path, when, when);
}

await put("memex.json", JSON.stringify({ id: "mx_synthetic_perf", name: "Perf fixture" }) + "\n", 0);
const areas = ["Projects", "Areas", "Resources", "Clients", "Journal", "Research"];
for (let i = 0; i < noteCount; i++) {
  const area = areas[i % areas.length];
  const folder = `wiki/${area}/group-${i % 23}/topic-${i % 7}`;
  const body = `# Synthetic note ${i}\n\n${"Plain generated prose for timing only. ".repeat(40)}\n`;
  // notes are the most recently touched rows; storage assets are older
  await put(`${folder}/note-${i}.md`, `---\nid: 01PERF${String(i).padStart(20, "0")}\n---\n${body}`, i / 10);
}
for (let i = 0; i < fileCount; i++) {
  await put(`storage/batch-${i % 40}/asset-${i}.bin`, randomBytes(fileBytes), 100 + i / 100);
}
for (let i = 0; i < 3000; i++) {
  await put(`.rotli/cache/projection-${i}.json`, JSON.stringify({ i, pad: "x".repeat(512) }), 1);
}
console.log(
  `${root}: ${noteCount} notes, ${fileCount} storage files of ${fileBytes / 1024} KiB, 3000 .rotli files`,
);
