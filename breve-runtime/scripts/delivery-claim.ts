/** Atomic claim around an external Breve delivery.
 *
 * A receipt still records completed delivery, while the cross-process lock
 * closes the check-then-send race before that receipt exists.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { acquireProcessLock, safeLockKey } from "./process-lock";

export type DeliveryClaim =
  | { status: "delivered" | "busy"; receipt: string }
  | {
    status: "claimed";
    receipt: string;
    complete: (details?: string) => Promise<void>;
    release: () => void;
  };

function safeReceiptName(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || /[^a-zA-Z0-9._/-]/.test(normalized)) {
    throw new Error(`Unsafe Breve delivery receipt: ${value}`);
  }
  return normalized;
}

export async function claimDelivery(
  home: string,
  receiptName: string,
  options: { waitMs?: number; pollMs?: number; force?: boolean } = {},
): Promise<DeliveryClaim> {
  const name = safeReceiptName(receiptName);
  const receipt = join(home, "delivery-receipts", name);
  const lock = await acquireProcessLock(home, `delivery-${safeLockKey(name)}`, {
    waitMs: options.waitMs ?? 30_000,
    pollMs: options.pollMs ?? 100,
  });
  if (!lock) {
    return {
      status: !options.force && await Bun.file(receipt).exists() ? "delivered" : "busy",
      receipt,
    };
  }
  if (!options.force && await Bun.file(receipt).exists()) {
    lock.release();
    return { status: "delivered", receipt };
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    lock.release();
  };
  return {
    status: "claimed",
    receipt,
    release,
    complete: async (details = "") => {
      mkdirSync(dirname(receipt), { recursive: true });
      await Bun.write(receipt, `${new Date().toISOString()}${details ? ` ${details}` : ""}\n`);
      release();
    },
  };
}
