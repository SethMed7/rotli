#!/usr/bin/env bun
/**
 * Seconds to wait until a meal's ARRIVAL time today, in Seth's effective (travel-aware) timezone.
 * Prints 0 if the arrival time has already passed. Capped at 3h so a misconfig can never sleep a
 * brief run forever. Used by the *-brief.sh wrappers to HOLD the send until the configured arrival
 * (generate early, deliver on time). Time is computed via timectx — never the bare system clock.
 *
 *   bun scripts/hold-until.ts morning   → e.g. 2700  (seconds until 07:00 local)
 */
import { loadSettings, effectiveTz, minutesNowIn, parseHM } from "./timectx";

const meal = (process.argv[2] ?? "morning") as "morning" | "lunch" | "night";
const s = await loadSettings();
const arrival = parseHM((s.deliveryTimes as any)[meal]);   // minutes since midnight
const now = minutesNowIn(effectiveTz(s));                   // minutes since midnight, effective tz
let secs = (arrival - now) * 60;
if (!Number.isFinite(secs) || secs < 0) secs = 0;
if (secs > 3 * 3600) secs = 3 * 3600;
console.log(Math.round(secs));
