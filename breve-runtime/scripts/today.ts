#!/usr/bin/env bun
// Prints the maintainer's current date (YYYY-MM-DD) in his effective timezone (travel-aware).
// Used by the shell wrappers so brief stems always match the daemon's notion of "today".
import { loadSettings, effectiveTz, todayIn } from "./timectx";
console.log(todayIn(effectiveTz(await loadSettings())));
