// The daily sweep that makes unsubscribing erase (unsubscribed.ts), against a mocked Resend:
// it reads the list's segment page by page, deletes only the contacts marked unsubscribed, never
// logs an address, stops on a page it cannot read, and goes on past a delete that fails.
import { describe, expect, test } from "bun:test";

import { createUnsubscribedSweep } from "./unsubscribed";

type Call = { method: string; url: string; auth: string | null };

/** A Resend double: pages of contacts by `after`, and a delete that answers per id. */
function resend(pages: Record<string, unknown>, deletes: Record<string, number> = {}) {
  const calls: Call[] = [];
  const fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ method, url: input, auth: new Headers(init.headers).get("authorization") });
    if (method === "GET") {
      const page = pages[url.searchParams.get("after") ?? ""];
      return page === undefined
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify(page), { status: 200 });
    }
    const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    const status = deletes[id] ?? 200;
    return new Response(JSON.stringify({ deleted: status === 200 }), { status });
  };
  return { calls, fetch };
}

const sleep = async () => {};
const contact = (id: string, unsubscribed: boolean) => ({ id, email: `${id}@example.com`, unsubscribed });

describe("the unsubscribed sweep", () => {
  test("is off without a key or a segment", () => {
    expect(createUnsubscribedSweep({ segmentId: "seg" })).toBeNull();
    expect(createUnsubscribedSweep({ apiKey: "key" })).toBeNull();
  });

  test("reads every page of the segment, then deletes only the unsubscribed", async () => {
    const api = resend({
      "": { has_more: true, data: [contact("a", false), contact("b", true)] },
      b: { has_more: false, data: [contact("c", true), contact("d", false)] },
    });
    const logs: string[] = [];
    const sweep = createUnsubscribedSweep({
      apiKey: "key",
      segmentId: "seg",
      fetch: api.fetch,
      sleep,
      log: (l) => logs.push(l),
    })!;
    expect(await sweep()).toEqual({ deleted: 2, failed: 0, complete: true });

    const gets = api.calls.filter((c) => c.method === "GET").map((c) => new URL(c.url));
    expect(gets.map((u) => u.pathname)).toEqual(["/contacts", "/contacts"]);
    expect(gets.every((u) => u.searchParams.get("segment_id") === "seg")).toBe(true);
    expect(gets.map((u) => u.searchParams.get("after"))).toEqual([null, "b"]);
    const deletes = api.calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).pathname);
    expect(deletes).toEqual(["/contacts/b", "/contacts/c"]);
    expect(api.calls.every((c) => c.auth === "Bearer key")).toBe(true);
    // Counts only: no address, no id.
    expect(logs).toEqual(["unsubscribed sweep: erased 2, failed 0"]);
    expect(logs.join(" ")).not.toContain("@");
  });

  test("a list with nobody unsubscribed deletes nothing and says nothing", async () => {
    const api = resend({ "": { has_more: false, data: [contact("a", false)] } });
    const logs: string[] = [];
    const sweep = createUnsubscribedSweep({
      apiKey: "key",
      segmentId: "seg",
      fetch: api.fetch,
      sleep,
      log: (l) => logs.push(l),
    })!;
    expect(await sweep()).toEqual({ deleted: 0, failed: 0, complete: true });
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(logs).toEqual([]);
  });

  test("a page it cannot read stops the run before any delete", async () => {
    const api = resend({ "": { has_more: true, data: [contact("b", true)] } });
    const logs: string[] = [];
    const sweep = createUnsubscribedSweep({
      apiKey: "key",
      segmentId: "seg",
      fetch: api.fetch,
      sleep,
      log: (l) => logs.push(l),
    })!;
    expect(await sweep()).toEqual({ deleted: 0, failed: 0, complete: false });
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(logs[0]).toContain("refused the contact list (500)");
  });

  test("a failed delete is counted and the rest still go; one already gone counts as erased", async () => {
    const api = resend(
      { "": { has_more: false, data: [contact("a", true), contact("b", true), contact("c", true)] } },
      { a: 500, b: 404 },
    );
    const logs: string[] = [];
    const sweep = createUnsubscribedSweep({
      apiKey: "key",
      segmentId: "seg",
      fetch: api.fetch,
      sleep,
      log: (l) => logs.push(l),
    })!;
    expect(await sweep()).toEqual({ deleted: 2, failed: 1, complete: true });
    expect(logs).toContain("unsubscribed sweep: resend refused a delete (500)");
    expect(logs.join(" ")).not.toContain("@");
  });

  test("spaces its calls to stay under Resend’s rate limit", async () => {
    const api = resend({
      "": { has_more: true, data: [contact("a", true)] },
      a: { has_more: false, data: [contact("b", true)] },
    });
    const waits: number[] = [];
    const sweep = createUnsubscribedSweep({
      apiKey: "key",
      segmentId: "seg",
      fetch: api.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
      log: () => {},
    })!;
    await sweep();
    // One wait between the two pages, one before each of the two deletes.
    expect(waits).toEqual([600, 600, 600]);
  });
});
