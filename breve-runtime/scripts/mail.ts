#!/usr/bin/env bun
/**
 * BREVE mail — READ-ONLY by construction (see ../docs/email-policy.md).
 * The only IMAP operations in this file: LIST, EXAMINE (read-only open), SEARCH, FETCH.
 * No APPEND (drafting ships later behind settings.mail.drafting), no STORE, no SMTP —
 * sending is architecturally absent. Mailboxes open readOnly, so even a bug can't
 * mutate server state. Credentials live in the macOS Keychain, never in files.
 *
 * Usage:
 *   bun mail.ts unread [account] [--limit 15]   — unread messages, newest first
 *   bun mail.ts search <text> [account]         — subject/from/body search (last 30 days)
 *   bun mail.ts read <uid> [account]            — one message's text body (for triage)
 * Output: JSON to stdout (the daemon feeds it to local Gemma for triage).
 */
import { join } from "node:path";
import { BREVE } from "./paths";
import { ImapFlow } from "imapflow";
import { readSecret } from "./secret";

const argv = process.argv.slice(2);
const cmd = argv[0];
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1]) || 15 : 15;
const args = argv.slice(1).filter((a, i) => a !== "--limit" && argv[argv.indexOf("--limit") + 1] !== a);

const accounts: any[] = await Bun.file(join(BREVE, "mail-accounts.json")).json().catch(() => []);
if (!accounts.length) { console.error("ERR no accounts in mail-accounts.json"); process.exit(1); }
// the account may appear anywhere in the args; everything else is the query/uid
const accountName = args.find((a) => accounts.some((acc) => acc.name === a)) ?? (cmd === "unread" ? args[0] : undefined);

async function connect(account: any): Promise<ImapFlow> {
  const pass = await readSecret(account.keychain).catch(() => {
    throw new Error(`no Keychain entry '${account.keychain}' — security add-generic-password -s ${account.keychain} -a seth -w <password> "$HOME/Library/Keychains/breve.keychain-db"`);
  });
  if (!pass) throw new Error(`no Keychain entry '${account.keychain}' — migrate it with scripts/keychain-migrate.sh`);
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: !!account.secure,
    // Bridge runs a STARTTLS listener with a self-signed cert on LOOPBACK ONLY —
    // verification is relaxed solely for 127.0.0.1; any remote host keeps full TLS.
    ...(account.starttls ? { tls: { rejectUnauthorized: account.host !== "127.0.0.1" && account.host !== "localhost" } } : {}),
    auth: { user: account.user, pass },
    logger: false,
  });
  await client.connect();
  return client;
}

function envelopeRow(msg: any) {
  return {
    uid: msg.uid,
    date: msg.envelope?.date,
    from: msg.envelope?.from?.map((f: any) => `${f.name || ""} <${f.address}>`.trim()).join(", "),
    subject: msg.envelope?.subject ?? "(no subject)",
    seen: msg.flags?.has("\\Seen") ?? false,
  };
}

if (cmd === "unread") {
  // Default: ALL accounts, merged — one ask covers the whole inbox surface.
  // "personal" = proton + gmail (excludes work). A failing account (Bridge down,
  // key missing) reports itself without sinking the rest.
  const wanted =
    accountName === "personal" ? accounts.filter((a) => ["proton", "gmail"].includes(a.name))
    : accountName && accountName !== "all" ? accounts.filter((a) => a.name === accountName)
    : accounts;
  const result: any = { unread: 0, accounts: {}, errors: {}, messages: [] };
  for (const acc of wanted) {
    if (acc.user.startsWith("FILL_ME_IN")) { result.errors[acc.name] = "address not configured"; continue; }
    try {
      const client = await connect(acc);
      try {
        // READ-ONLY open: imapflow issues EXAMINE, so the server itself refuses mutations.
        await client.mailboxOpen("INBOX", { readOnly: true });
        const uids = await client.search({ seen: false }, { uid: true });
        result.accounts[acc.name] = (uids ?? []).length;
        result.unread += (uids ?? []).length;
        const pick = (uids ?? []).slice(-LIMIT);
        if (pick.length) {
          for await (const msg of client.fetch(pick, { uid: true, envelope: true, flags: true }, { uid: true }))
            result.messages.push({ account: acc.name, ...envelopeRow(msg) });
        }
      } finally {
        await client.logout().catch(() => {});
      }
    } catch (e: any) {
      result.errors[acc.name] = String(e?.message ?? e).slice(0, 140);
    }
  }
  result.messages.sort((a: any, b: any) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
  result.messages = result.messages.slice(0, LIMIT * 2);
  console.log(JSON.stringify(result, null, 1));
  process.exit(0);
}

// search/read operate on ONE account (named, default first = proton)
const account = accounts.find((a) => a.name === (accountName ?? "proton")) ?? accounts[0];
if (account.user.startsWith("FILL_ME_IN")) { console.error("ERR mail-accounts.json: set the 'user' address for " + account.name); process.exit(1); }
const client = await connect(account).catch((e) => { console.error(`ERR ${e?.message ?? e}`); process.exit(1); });
try {
  await client.mailboxOpen("INBOX", { readOnly: true });

  if (cmd === "search") {
    const q = args.filter((a) => !accounts.some((acc) => acc.name === a)).join(" ");
    if (!q) { console.error("ERR search needs a query"); process.exit(1); }
    const since = new Date(Date.now() - 30 * 86400_000);
    const uids = await client.search({ or: [{ subject: q }, { from: q }, { body: q }], since }, { uid: true });
    const out: any[] = [];
    const pick = (uids ?? []).slice(-LIMIT);
    if (pick.length) {
      for await (const msg of client.fetch(pick, { uid: true, envelope: true, flags: true }, { uid: true })) out.push(envelopeRow(msg));
    }
    console.log(JSON.stringify({ account: account.name, query: q, matches: out.reverse() }, null, 1));
  } else if (cmd === "read") {
    const uid = parseInt(args[0]);
    if (!uid) { console.error("ERR read needs a uid"); process.exit(1); }
    const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true, source: true }, { uid: true });
    const raw = msg?.source?.toString() ?? "";
    // crude text extraction: prefer text/plain part; fall back to stripped html
    let body = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n");
    body = body
      .replace(/=\r?\n/g, "") // quoted-printable soft breaks
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#\d+;/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 8000);
    console.log(JSON.stringify({ ...envelopeRow(msg), body }, null, 1));
  } else {
    console.error("ERR usage: mail.ts unread|search <q>|read <uid> [account] [--limit N]");
    process.exit(1);
  }
} finally {
  await client.logout().catch(() => {});
}
