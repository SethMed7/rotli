export const DAILY_CATCHUP_MINUTES = 6 * 60;

/** Attempts per daily slot before the scheduler stops retrying it. Three
 * covers a transient model hiccup without turning a broken writer into a
 * five-minute failure storm (~400 logged failures a day while the writer was
 * broken, audit 2026-09-02 §1.1); the next slot starts fresh. */
export const MAX_SLOT_ATTEMPTS = 3;

/** Whether a daily slot still deserves an attempt, given the job's ledger
 * entry. Pure, so the retry policy is testable without a scheduler. */
export function slotAttemptAllowed(
  job: { pendingSlot?: string; attempts?: number },
  slot: string,
): boolean {
  if (job.pendingSlot !== slot) return true;
  return (job.attempts ?? 0) < MAX_SLOT_ATTEMPTS;
}

export function parseHm(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function dailyDue(
  nowMinutes: number,
  fireMinutes: number,
  slot: string,
  lastSlot: string | undefined,
): boolean {
  if (lastSlot === slot) return false;
  const elapsed = (nowMinutes - fireMinutes + 1440) % 1440;
  return elapsed <= DAILY_CATCHUP_MINUTES;
}

export function intervalDue(now: number, seconds: number, lastStarted: string | undefined): boolean {
  if (!lastStarted) return false;
  const then = Date.parse(lastStarted);
  return Number.isFinite(then) && now - then >= seconds * 1000;
}

export function schedulerParentGone(
  expectedParent: number,
  actualParent: number,
  isAlive: (pid: number) => boolean,
): boolean {
  return expectedParent > 0 && (actualParent !== expectedParent || !isAlive(expectedParent));
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return next.toISOString().slice(0, 10);
}

/** Delivery-day identity for a run whose lead crosses midnight. */
export function dailySlot(today: string, nowMinutes: number, delivery: number, fire: number): string {
  return fire > delivery && nowMinutes >= fire ? nextDate(today) : today;
}
