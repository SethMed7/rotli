// The vault the hero film's Mac clip is shot in (capture-hero.mjs, site/README.md "Films"): a
// labeled demo vault holding the same synthetic notes as the web take, and the note written on
// camera waiting in wiki/_inbox for the Librarian, word for word, already in Main. Its own
// .rotli/settings.json lets the Librarian file it within about a minute of the app opening it
// (a 5-second quiet window, the on-device model, a filing sentence for Clients, people groups off)
// and opens the Vault view on Clients, so the note is seen leaving _inbox and landing there.
// The file's raw fields stay hidden: an open note does not yet redraw them after the move.
//
//   bun scripts/hero-librarian-vault.mjs "/tmp/rotli-hero/Rotli Hero Demo"
//
// hero-librarian-take.mjs builds it fresh for every take and opens it in a sandboxed debug build;
// never point the installed app at it (the app rewrites its settings files, 2026-10-09). It only
// writes into an empty or missing folder, so it can never touch a real vault.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { FILED, NOTE_LINES } from "./hero-film-fixture.mjs";

const target = process.argv[2];
if (!target) throw new Error('Usage: bun scripts/hero-librarian-vault.mjs "<empty folder>"');
const root = resolve(target);
const existing = await readdir(root).catch(() => []);
if (existing.length > 0) throw new Error(`${root} is not empty; pick a new folder`);

/** A ULID, as Rotli stamps a note's `id`: 48-bit time, then 80 random bits, in Crockford base32. */
function ulid() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const encode = (value, length) => {
    let out = "";
    for (let i = 0; i < length; i++) {
      out = alphabet[Number(value & 31n)] + out;
      value >>= 5n;
    }
    return out;
  };
  return encode(BigInt(Date.now()), 10) + encode(BigInt(`0x${randomBytes(10).toString("hex")}`), 16);
}

const id = ulid();
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const note = `---
id: ${id}
created: ${now}
updated: ${now.slice(0, 10)}
pinned: false
aliases: []
owner: rotli
shelf: [Inbox]
reach: []
area:
summary:
tags: []
links: []
---

${NOTE_LINES.join("\n")}
`;
const files = {
  ...FILED,
  "wiki/_inbox/call-w-dana-re-pricing.md": note,
  "memex.json": JSON.stringify(
    { id: `mx_${randomUUID()}`, contract: "3.8", createdAt: now, selfHeal: true, apps: {} },
    null,
    2,
  ),
  ".rotli/main.json": JSON.stringify({ version: 1, tree: [{ note: id }] }, null, 2),
  ".rotli/settings.json": JSON.stringify(
    {
      organizerTrust: "organize",
      organizerQuietSecs: 5,
      organizerThreshold: 0.3,
      organizerModel: "local",
      brainEnabled: true,
      // the Vault view opens on Clients, System folded, as the web take shows it
      expandedDests: { "main:Clients": true, "sec:system": false },
      librarianRules: {
        people: { mode: "simple" },
        filing: ["Notes about Dana, pricing, deals, or customers go to Clients"],
      },
    },
    null,
    2,
  ),
  "README-DEMO.txt": "Demo vault for the rotli.co hero film. Synthetic notes only. Safe to delete.\n",
};
for (const [path, text] of Object.entries(files)) {
  const out = join(root, path);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
}
console.log(`Hero demo vault: ${root} (the note ${id} waits in wiki/_inbox, in Main)`);
