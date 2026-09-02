// Bounded slot retries (audit 2026-09-02 §1.1): a failing writer used to be
// retried every five minutes for the whole delivery window — ~400 logged
// failures a day for 17 days, all invisible in the app. The policy is pure so
// it is pinned here without spawning a scheduler.
import { MAX_SLOT_ATTEMPTS, slotAttemptAllowed } from "../scripts/scheduler-core";

let failed = 0;
const check = (condition: boolean, message: string) => {
  if (condition) return;
  failed += 1;
  console.error(`FAIL ${message}`);
};

check(MAX_SLOT_ATTEMPTS === 3, "three attempts per slot");
check(slotAttemptAllowed({}, "2026-09-02"), "a never-run job may start");
check(slotAttemptAllowed({ pendingSlot: "2026-09-01", attempts: 9 }, "2026-09-02"), "a new slot starts fresh");
check(slotAttemptAllowed({ pendingSlot: "2026-09-02", attempts: 2 }, "2026-09-02"), "under the ceiling → retry");
check(!slotAttemptAllowed({ pendingSlot: "2026-09-02", attempts: 3 }, "2026-09-02"), "at the ceiling → give up");
check(!slotAttemptAllowed({ pendingSlot: "2026-09-02", attempts: 40 }, "2026-09-02"), "past the ceiling → give up");
check(slotAttemptAllowed({ pendingSlot: "2026-09-02" }, "2026-09-02"), "missing attempts counts as zero");

if (failed) process.exit(1);
console.log("OK scheduler slot retry policy");
