import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimDelivery } from "../scripts/deliveryClaim";

const root = () => mkdtempSync(join(tmpdir(), "breve-delivery-"));

describe("Breve delivery claims", () => {
  test("only one concurrent sender gets the claim", async () => {
    const dir = root();
    const first = await claimDelivery(dir, "2026-07-13.signal", { waitMs: 0 });
    const second = await claimDelivery(dir, "2026-07-13.signal", { waitMs: 0 });
    expect(first.status).toBe("claimed");
    expect(second.status).toBe("busy");
    if (first.status === "claimed") await first.complete("message-id");

    const third = await claimDelivery(dir, "2026-07-13.signal", { waitMs: 0 });
    expect(third.status).toBe("delivered");
    expect(await Bun.file(third.receipt).text()).toContain("message-id");
  });

  test("supports namespaced notification receipts but rejects traversal", async () => {
    const dir = root();
    const claim = await claimDelivery(dir, "notifications/morning-fallback.signal", { waitMs: 0 });
    expect(claim.status).toBe("claimed");
    if (claim.status === "claimed") claim.release();
    expect(claimDelivery(dir, "../outside", { waitMs: 0 })).rejects.toThrow("Unsafe");
  });

  test("forced redelivery still serializes on the same receipt", async () => {
    const dir = root();
    const initial = await claimDelivery(dir, "2026-07-13.email", { waitMs: 0 });
    if (initial.status === "claimed") await initial.complete();

    const forced = await claimDelivery(dir, "2026-07-13.email", { waitMs: 0, force: true });
    const concurrent = await claimDelivery(dir, "2026-07-13.email", { waitMs: 0, force: true });
    expect(forced.status).toBe("claimed");
    expect(concurrent.status).toBe("busy");
    if (forced.status === "claimed") forced.release();
  });
});
