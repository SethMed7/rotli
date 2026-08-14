# Local-model compute guardrails — admission, queue, prioritize

Status: **BUILT** (2026-08-01). Scope: the **local** model lane only
(`chat_messages` against a loopback endpoint). Claude / Codex / Gemini ride
provider-side capacity and are untouched by everything below.

Seth's ask, verbatim: *"for opening local and doing multiple just have guard
rails against compute — example I try to open a third it will mention there
isn't enough compute or something and say message is queued but I can
prioritize it. This needs to be based on guard rails though not set numbers."*

So the contract is: **concurrent local chats stay allowed.** What is gated is
each local *inference request*, and the gate is **measured headroom on this
Mac** — never a chat count, never "max 2". When a request doesn't fit it is
**queued** (not refused), the chat says so honestly, and the user can
**prioritize** it to the front.

## 1. What is actually measured

Everything comes from `/usr/sbin/sysctl -n`, the same subprocess pattern
`localmodel.rs::system_profile` already uses. **No new crate.** Rotli ships no
`libc`/`sysinfo` dependency and this feature does not add one.

| Reading | sysctl | Why this one |
| --- | --- | --- |
| Total RAM | `hw.memsize` | Converts a model's MB footprint into percentage points, so the rule scales with the machine instead of hard-coding gigabytes. |
| Available memory | `kern.memorystatus_level` | The **kernel's own availability percentage** (0–100) — the jetsam level. |
| Pressure verdict | `kern.memorystatus_vm_pressure_level` | macOS's own answer: `1` normal · `2` warn · `4` critical. |

**Why not `vm.page_free_count`.** On a healthy Mac it is misleadingly tiny —
on the 64 GB development machine it reads ~3.9 GB (6%) while the system is
completely idle, because macOS deliberately keeps RAM working (file cache,
purgeable, compressor). A rule built on "free pages" would refuse every request
forever. `kern.memorystatus_level` on the same machine reads **52**, which is
the honest answer: about half this Mac's memory is reclaimable right now. We
depend only on the property that it is the kernel's normalized availability
signal, monotone in real availability — not on its exact page-set composition,
which is an XNU implementation detail.

**The model's working footprint** is the `approxMB` the memex-ai registry
already records for that model (written at install time by
`localmodel.rs::append_model`). Missing/zero ⇒ the `localModelFootprintMB`
knob's conservative default.

## 2. What the sidecar can genuinely serve at once

This is the load-bearing fact, and it is *not* a number we chose.

`localmodel.rs`'s header states it: since **mlx-server 0.3** the server "honors
the request's `model` and swaps its single loaded slot on demand". One slot.
Lazy load, idle unload. Two consequences the admission rule is built on:

- **Same model, two requests** — the weights are already resident. The second
  request's marginal cost is KV cache + activations, not another full copy of
  the weights.
- **Different model while one is in flight** — admitting it would make the
  server evict the running generation's weights mid-stream and reload. That is
  thrash, not concurrency. So a different-model request **waits for the slot**,
  regardless of how much memory is free. This is a structural rule derived from
  the server's contract, not a tuned threshold.

The organizer daemon is a third consumer of the same sidecar; it is already
yielded for the duration of an interactive turn by `interactive_guard()`
(`chat.rs`), and the ticket is acquired *inside* that guard so a queued turn
keeps the daemon out of the way rather than racing it.

## 3. The admission rule

Evaluated for a candidate request `C` (model `m`, weights `f` MB) against the
set of in-flight local requests, in order. The first rule that fires wins.

1. `localComputeGuardrails: false` ⇒ **admit**. (Explicit user opt-out.)
2. The endpoint is not loopback ⇒ **admit**, un-ticketed. Remote lanes are out
   of scope.
3. Any in-flight request has a model ≠ `m` ⇒ **wait** — *"another local model
   is still generating"*. (§2, the single slot.)
4. The memory reading is unavailable ⇒ **serialize**: admit iff nothing is in
   flight, otherwise **wait** — *"can't measure this Mac's memory — running
   local requests one at a time"*. (Justified in §5.)
5. Pressure is `critical` ⇒ **wait** — *"this Mac is low on memory right now"*.
6. Otherwise, headroom arithmetic:

   ```
   resident   = some in-flight request already uses model m
   marginal   = (resident ? 0 : f) + localRequestOverheadMB          // MB
   cost_pct   = marginal / (hw.memsize in MB) * 100
   reserve    = localMinFreePercent * (pressure == warn ? localWarnReserveMultiplier : 1)

   admit  ⟺  kern.memorystatus_level - cost_pct  >=  reserve
   ```

   Otherwise **wait** — *"not enough compute headroom right now"*.

7. **Fairness**: only the request at the **head of the queue** is ever
   evaluated for admission. A later arrival cannot jump a waiting one by being
   cheaper. `prioritize` is the only way to change the order, and it is the
   user's hand.

The comparison is `>=`, so a request landing *exactly* on the reserve line is
admitted. (Covered by a boundary test both ways.)

Note what this produces on real hardware without anyone naming a chat count: on
a 64 GB Mac at 52% available, an 8 GB model costs ~13 points, leaving ~39 —
several concurrent same-model turns fit. On a 16 GB Mac the same model costs
~53 points and the second concurrent turn queues immediately. Same rule, machine
decides.

## 4. The queue

- **FIFO** by arrival. One entry per request id.
- **Prioritize** moves an entry to index 0. Prioritizing a second entry puts
  *it* at 0 (most recent intent wins) — simple and honest, no priority classes.
- **Cancel** removes the entry and wakes its waiter with a cancelled error.
  Both Stop and closing the chat route here, so a queued send can always be
  taken back. Cancelling an id that is already running is a no-op (the local
  HTTP can't be aborted mid-generation — the frontend's run-orphaning is still
  the honest cancel there, exactly as before).
- **Depth cap** `localQueueMax`: an arrival past the cap gets an immediate,
  honest error instead of an unbounded wait.
- **Wait ceiling** `localQueueWaitSecs`: a waiter that never becomes admissible
  fails honestly rather than hanging forever.
- **Re-evaluation** happens when a ticket is released, when the queue is
  mutated, and every `localQueuePollMs` — memory changes on its own (another
  app quits), so waiting must be a poll, not purely event-driven.
- Every mutation emits the full snapshot on `rotli:local-queue`, so the surface
  never has to infer state.

## 5. Failure honesty — why serialize, not fail open

If the sysctl read fails, the choice is: admit everything (fail open), refuse
everything (fail closed), or **serialize**.

- Fail open re-creates the exact bug this feature exists to prevent — unbounded
  concurrent local generations, swap thrash, a beachballed Mac.
- Fail closed makes an unreadable sysctl into a total loss of the local lane.
- **Serialize** is the honest floor: §2 already establishes that a single-slot
  sidecar's true concurrency guarantee is one. Degrading to it costs latency and
  nothing else — no request is lost, order is preserved, work completes. And the
  user is *told*: the queued reason string names the missing measurement rather
  than pretending to be a headroom verdict.

So: **serialize, and say so.** The same principle as the rest of rotli's
failure copy — never a silent degrade, never a lie about why.

## 6. The knobs (§6.4, knob-not-constant)

All eight live in the vault's `.rotli/settings.json`, **Rust reads only** —
identical to the organizer's `organizerQuietSecs` / `organizerThreshold`
contract. They follow the `organizerThreshold` precedent specifically: no
`PersistedSettings` field and no Settings control, so they round-trip untouched
via `unknownSettingsKeys` in `src/state/persist.ts`. The defaults are the
product; these exist so a machine that disagrees can be corrected without a
rebuild.

| Knob | Default | Meaning |
| --- | --- | --- |
| `localComputeGuardrails` | `true` | Master switch. `false` ⇒ admit everything (§3.1). |
| `localMinFreePercent` | `20` | Percent of this Mac's memory that must remain available *after* admitting. |
| `localWarnReserveMultiplier` | `2.0` | Reserve multiplier while macOS reports `warn` pressure. |
| `localRequestOverheadMB` | `768` | Marginal cost of one more concurrent request on an already-resident model (KV cache + activations). |
| `localModelFootprintMB` | `8192` | Fallback weights footprint when the registry has no `approxMB`. Deliberately pessimistic. |
| `localQueueMax` | `8` | Queue depth before an honest refusal. |
| `localQueueWaitSecs` | `600` | Ceiling on a single wait. |
| `localQueuePollMs` | `1500` | Re-check cadence while waiting. |

Every value is validated on read (finite, in range) and falls back to its
default rather than adopting a nonsense number.

## 7. Implementation map

| Piece | Where |
| --- | --- |
| Pure rule + queue + waiting | `src-tauri/src/compute.rs` (new) |
| Ticket acquire/release around the local POST | `src-tauri/src/chat.rs` — `chat_messages` gains `request_id: Option<String>` |
| State + event sink + command registration | `src-tauri/src/lib.rs` |
| Snapshot event | `rotli:local-queue` → `onLocalQueue` in `src/lib/tauri.ts` |
| Commands | `local_queue_status` · `local_queue_prioritize` · `local_queue_cancel` |
| requestId forwarded to the wire | `src/ai/host.ts` (`complete`) → `src/lib/tauri.ts` (`chatMessages`) |
| Queued state + Prioritize button | `src/components/chat/chatSurface.tsx` (the busy bubble) + `.cmsg-queued*` in `src/styles/memex.css` |

The frontend already mints a `requestId` per turn and threads it through
`hostOpts` for CLI kill-on-cancel; the local lane simply starts carrying the
same id. Nothing new is generated, and `loop.ts` is untouched — `host.complete`
is the single chokepoint every local request passes through.

## 8. Deliberately out of scope

- **Real mid-generation abort for the local lane.** `chat_messages` still can't
  interrupt an in-flight `ureq` POST; Stop on a *running* local turn keeps
  orphaning the run as it did before. Only the *queued* portion is genuinely
  cancellable now. Making the local POST abortable is its own change (a
  cancel registry mirroring `ProviderState`, or a streaming rewrite).
- **Gating the organizer daemon's own local calls.** It reaches the sidecar via
  `chat::complete_local`, outside `chat_messages`. It is already yielded during
  interactive turns, which is the contention that matters; ticketing it too is a
  follow-up.
- **GPU / ANE utilization signals.** No unprivileged, stable sysctl exposes
  them. Memory is the binding constraint for MLX on Apple Silicon.
- **A Settings UI for the knobs.** They are tuning, not product surface. If a
  user ever needs one, promote them to `PersistedSettings` following
  `organizerQuietSecs`.
