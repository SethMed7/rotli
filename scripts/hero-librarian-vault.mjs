// The vault the hero film's Mac clip is shot in (capture-hero.mjs, site/README.md "Films"): the
// same synthetic notes as the web take, and the note written on camera waiting in wiki/_inbox for
// the Librarian, word for word. Open the folder in the Mac app, let the Librarian file the note,
// and screen-record that window.
//
//   bun scripts/hero-librarian-vault.mjs /tmp/rotli-hero-vault
//
// It only writes into an empty or missing folder, so it can never touch a real vault.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { FILED, NOTE_LINES } from "./hero-film-fixture.mjs";

const target = process.argv[2];
if (!target) throw new Error("Usage: bun scripts/hero-librarian-vault.mjs <empty folder>");
const root = resolve(target);
const existing = await readdir(root).catch(() => []);
if (existing.length > 0) throw new Error(`${root} is not empty; pick a new folder`);

const files = { ...FILED, "wiki/_inbox/dana-call.md": `${NOTE_LINES.join("\n")}\n` };
for (const [path, text] of Object.entries(files)) {
  const out = join(root, path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
}
console.log(`Hero vault: ${Object.keys(files).length} notes in ${root}`);
console.log("Open it in Rotli, then file wiki/_inbox/dana-call.md with the Librarian on camera.");
