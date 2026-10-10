// Unsubscribing erases (the owner, 2026-10-07). Resend keeps a contact who clicks a Broadcast's
// unsubscribe link (or a mail app's one-click Unsubscribe) marked `unsubscribed` rather than
// deleting it; this sweep deletes every such contact in the list's segment, so leaving the list
// removes the address from Resend too. It runs from the sidecar (main.ts) shortly after start and
// then once a day, only while the list is on.
//
//   GET    /contacts?segment_id=…&limit=100[&after=…]  → { has_more, data: [{ id, unsubscribed }] }
//   DELETE /contacts/{id}                                 → { deleted: true }
//
// (resend.com/docs, checked 2026-10-07.) Contacts are global per address in Resend, so deleting
// one removes it from every segment; only contacts in this segment who unsubscribed are touched.
// A later signup with the same address starts fresh. Addresses are never logged: only counts and
// Resend's status. A failed page stops the run (the next one retries); a failed delete is counted
// and the run goes on. Calls are spaced to stay under Resend's default rate limit.

const RESEND_API = "https://api.resend.com";
const TIMEOUT_MS = 8000;
const PAGE_SIZE = 100;
/** Resend allows about two requests a second by default. */
const SPACING_MS = 600;
/** One run a day, the first a minute after start (so a deploy does not wait a day). */
export const SWEEP_EVERY_MS = 24 * 60 * 60_000;
export const FIRST_SWEEP_MS = 60_000;

export interface SweepOptions {
  apiKey?: string;
  segmentId?: string;
  /** Injected in tests; the real one talks to api.resend.com. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface SweepResult {
  deleted: number;
  failed: number;
  /** False when a page of contacts could not be read, so some were not looked at. */
  complete: boolean;
}

type Page = { has_more?: unknown; data?: unknown };
type Contact = { id: string; unsubscribed: boolean };

function contactsOf(page: Page): Contact[] {
  if (!Array.isArray(page.data)) return [];
  return page.data.flatMap((item: unknown) => {
    const { id, unsubscribed } = (item ?? {}) as { id?: unknown; unsubscribed?: unknown };
    return typeof id === "string" && id ? [{ id, unsubscribed: unsubscribed === true }] : [];
  });
}

/** A sweep for this list, or null when the list is off (no key or segment). */
export function createUnsubscribedSweep(options: SweepOptions = {}): (() => Promise<SweepResult>) | null {
  const { apiKey, segmentId, log = (line) => console.warn(line) } = options;
  if (!apiKey || !segmentId) return null;
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const call = (method: "GET" | "DELETE", path: string) =>
    send(`${RESEND_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  return async function sweep(): Promise<SweepResult> {
    // Read every page first, then delete: deleting while paging would shift the cursor.
    const leaving: string[] = [];
    let after: string | undefined;
    for (;;) {
      const query = new URLSearchParams({ segment_id: segmentId, limit: String(PAGE_SIZE) });
      if (after) query.set("after", after);
      let page: Page;
      try {
        const res = await call("GET", `/contacts?${query}`);
        if (!res.ok) {
          log(`unsubscribed sweep: resend refused the contact list (${res.status}); trying again next run`);
          return { deleted: 0, failed: 0, complete: false };
        }
        page = (await res.json()) as Page;
      } catch (error) {
        log(
          `unsubscribed sweep: the contact list did not load (${error instanceof Error ? error.name : "error"})`,
        );
        return { deleted: 0, failed: 0, complete: false };
      }
      const contacts = contactsOf(page);
      leaving.push(...contacts.filter((contact) => contact.unsubscribed).map((contact) => contact.id));
      const last = contacts.at(-1);
      if (page.has_more !== true || !last) break;
      after = last.id;
      await sleep(SPACING_MS);
    }

    let deleted = 0;
    let failed = 0;
    for (const id of leaving) {
      await sleep(SPACING_MS);
      try {
        const res = await call("DELETE", `/contacts/${encodeURIComponent(id)}`);
        if (res.ok || res.status === 404) deleted += 1;
        else {
          failed += 1;
          log(`unsubscribed sweep: resend refused a delete (${res.status})`);
        }
      } catch (error) {
        failed += 1;
        log(
          `unsubscribed sweep: a delete did not go through (${error instanceof Error ? error.name : "error"})`,
        );
      }
    }
    if (deleted || failed) log(`unsubscribed sweep: erased ${deleted}, failed ${failed}`);
    return { deleted, failed, complete: true };
  };
}

/** Run the sweep a minute after start and then daily; nothing when the list is off. */
export function scheduleUnsubscribedSweep(sweep: (() => Promise<SweepResult>) | null): void {
  if (!sweep) return;
  const run = () => {
    sweep().catch(() => undefined);
  };
  setTimeout(() => {
    run();
    setInterval(run, SWEEP_EVERY_MS);
  }, FIRST_SWEEP_MS);
}
