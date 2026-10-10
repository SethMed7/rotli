// The owner's window into the roadmap database (site/server/roadmap.ts). Feature requests
// are never published by the site; this is how they are read. Run it where the database
// is: inside the Railway container (`railway ssh`, see site/README.md) or against a copy.
//
//   bun site/scripts/roadmap-requests.ts                 new requests, oldest first
//   bun site/scripts/roadmap-requests.ts --all           every request, any status
//   bun site/scripts/roadmap-requests.ts --json          the same, as JSON
//   bun site/scripts/roadmap-requests.ts votes           vote counts, most first
//   bun site/scripts/roadmap-requests.ts mark 12 read    set a status (new, read, planned, declined)
//   bun site/scripts/roadmap-requests.ts delete 12       remove a request (someone asked, or spam)
//
// The database is ROADMAP_DB_PATH, or `--db <file>`.
import { existsSync } from 'node:fs';

import { openRoadmapDb } from '../server/roadmap';

const STATUSES = ['new', 'read', 'planned', 'declined'] as const;

interface Request {
  n: number;
  created_at: string;
  title: string;
  description: string;
  email: string | null;
  status: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');
const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : process.env.ROADMAP_DB_PATH;
const rest = dbFlag < 0 ? args : args.filter((_, index) => index !== dbFlag && index !== dbFlag + 1);
const json = rest.includes('--json');
const all = rest.includes('--all');
const [command, ...params] = rest.filter((arg) => !arg.startsWith('--'));

if (!dbPath) fail('Set ROADMAP_DB_PATH or pass --db <file>.');
if (!existsSync(dbPath)) fail(`No roadmap database at ${dbPath} yet (it is created on the first vote or request).`);
const db = openRoadmapDb(dbPath);

try {
  if (command === undefined) {
    const rows = db
      .query<Request, []>(
        `SELECT n, created_at, title, description, email, status FROM requests ${all ? '' : "WHERE status = 'new'"} ORDER BY n`,
      )
      .all();
    if (json) console.log(JSON.stringify(rows, null, 2));
    else if (rows.length === 0) console.log(all ? 'No requests yet.' : 'No new requests. (--all shows every one.)');
    else {
      for (const row of rows) {
        console.log(`#${row.n} · ${row.created_at.slice(0, 16).replace('T', ' ')} UTC · ${row.status}${row.email ? ` · ${row.email}` : ''}`);
        console.log(`  ${row.title}`);
        for (const line of row.description.split('\n')) console.log(`    ${line}`);
        console.log('');
      }
    }
  } else if (command === 'votes') {
    const rows = db.query<{ id: string; count: number }, []>('SELECT id, count FROM votes ORDER BY count DESC, id').all();
    if (json) console.log(JSON.stringify(rows, null, 2));
    else if (rows.length === 0) console.log('No votes yet.');
    else for (const row of rows) console.log(`${String(row.count).padStart(5)}  ${row.id}`);
  } else if (command === 'mark') {
    const [n, status] = params;
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) fail(`Status is one of: ${STATUSES.join(', ')}.`);
    const { changes } = db.query<unknown, [string, number]>('UPDATE requests SET status = ? WHERE n = ?').run(status, Number(n));
    console.log(changes ? `#${n} is ${status}.` : `No request #${n}.`);
  } else if (command === 'delete') {
    const [n] = params;
    const { changes } = db.query<unknown, [number]>('DELETE FROM requests WHERE n = ?').run(Number(n));
    console.log(changes ? `#${n} deleted.` : `No request #${n}.`);
  } else {
    fail(`Unknown command "${command}". Commands: (none) · votes · mark <n> <status> · delete <n>.`);
  }
} finally {
  db.close();
}
