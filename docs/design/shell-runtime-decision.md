# Shell runtime: stay on Tauri

Status: **DECISION** (2026-08-06, at `6e95b25` / 0.77.0). Evaluated Tauri vs
Electron on the question that prompted it — *is rotli a good citizen on the
user's computer?* — and on the requirement that rotli eventually ship for Linux
and Windows. **Decision: stay on Tauri.** This document records the measurements
so the question does not have to be re-argued from vibes.

## The claim under test

"Tauri takes a lot of energy from your computer." **Denied for this codebase, on
measurement.** The claim is not invented — it describes real, reproducible bugs —
but they are app-shaped, not framework-shaped, and rotli does not have them.

## What was measured

Machine: M4 Max, macOS. rotli 0.77.0 from `/Applications`, one **visible,
non-frontmost** window (`AXMinimized=false`, `frontmost=false` — the honest
state; a fully hidden window would flatter the result).

**Idle draw, 120-second window, CPU-seconds consumed:**

| App | Processes | CPU-s / 120s | % of one core |
|---|---|---|---|
| rotli (Tauri / WKWebView) | 5 | **0.01** | 0.008% |
| Discord (Electron) | 7 | **1.34** | 1.12% |

**Lifetime average since launch:**

| App | Uptime | CPU-s | Avg % of a core | RSS |
|---|---|---|---|---|
| rotli | 12h 39m | 48.9 | **0.107%** | ~410 MB |
| Discord | 24d 12h | 63,853 | **3.01%** | ~1.28 GB |

Discord is not a controlled comparator — it holds websockets and presence — so
this is a real-world observation, not a lab A/B. The 134× idle gap is too large
to be explained by its networking alone, and the direction is not in doubt.

## Where the "Tauri burns energy" reports come from

- Hoppscotch: [200% CPU on macOS while idle and backgrounded](https://github.com/hoppscotch/hoppscotch/issues/3990)
- opencode: [30–40% idle CPU at `tauri://localhost`](https://github.com/anomalyco/opencode/issues/19106)
- Tauri: [`resizable(false)` causes runaway CPU on macOS](https://github.com/tauri-apps/tauri/issues/11308),
  and an open [macOS performance tracker](https://github.com/tauri-apps/tauri/issues/11822)

Mechanism: **Chromium suspends rAF and throttles timers for an occluded
renderer; WKWebView makes no equivalent promise.** Electron therefore partly
protects an app from its own idle animation loop, and Tauri does not. Every
report above is an animation or timer running where nobody could see it.

rotli's exposure was audited: **5** infinite CSS animations, all
state-conditional (live / running / thinking / skeleton), and **3** `setInterval`
calls in 65,815 lines of frontend. The discipline that keeps rotli cheap was
already there — it was simply unenforced. That is what
`:root[data-idle="hidden"]` in `src/styles/base.css`, `src/lib/idleMotion.ts`,
and the `check:design-system` contract now fix.

Persistent sidebar state is stricter: it stays static. A chat entering Working
or Unread updates its labeled lane and dot immediately, then schedules no
animation while the state remains unchanged. This follows the measured lesson
from [Herdr's sidebar work](https://herdr.dev/blog/ten-agents-three-clients-95-percent-less-cpu/):
motion should mean something changed, not merely that a process is still alive.

### An honest negative result

A WKWebView harness (native `NSWindow` + `WKWebView`, 240 elements each running
an infinite opacity/transform animation, 15-second sampling windows) was built to
measure the saving directly. **No delta was detectable** between animating-
visible, animating-hidden, and paused in the app's own processes — all three sat
at 0.01–0.03 CPU-s per 15s, and the WebKit GPU process reported 0.000s
throughout. Composited animation cost lands in **WindowServer**, which is
system-wide and cannot be attributed on a machine in use.

So the idle-pause work is a **regression guard and Linux insurance, not a macOS
speedup**, and it is deliberately documented that way in the code. Claiming a
macOS win here would be unsupported.

What the harness *did* prove, and what the guard depends on: the Page Visibility
state really does flip to `hidden` when a window is `orderOut`'d and the app
hidden — the exact path a menu-bar app uses to tuck its window away.

Rebuild it with a ~60-line Swift file: an `NSWindow` hosting a `WKWebView` whose
page carries an infinite CSS animation and posts `document.visibilityState`
through a `WKScriptMessageHandler`; sample `ps -o time=` for the app, its
`com.apple.WebKit.WebContent`/`GPU` children, and `WindowServer` across a fixed
window, in `visible`, `hidden`, and `animation-play-state: paused` modes.

## Where rotli's energy actually goes

Not the shell. Per `local-model-quality-and-performance.md`: prefill runs at
~440 tok/s and dominates a step by ~15×; the 128k tier's stable prefix is ~5k
tokens ≈ **~11 s of GPU-saturating prefill, re-paid on every one of up to 5 steps
plus an unconditional force-final**; and there is no prompt cache. One chat turn
costs more than the webview does in a day of idling.

Worse, the guard meant to protect the machine is dead: `probe_thermal_ok()`
greps `pmset -g therm` for `CPU_Speed_Limit`, an Intel-era field absent on Apple
Silicon, so it falls through to `true` and **has been permanently open for its
entire life**.

**Migrating to Electron would move that number by zero joules** and add
Chromium's baseline on top. The measurable win is in that plan, not in this one.

## Cost of migrating, for the record

| | |
|---|---|
| Rust | 30,425 lines, 22 modules |
| IPC | 147 `#[tauri::command]` handlers |
| Frontend | 65,815 lines TS/TSX — but only **3 files** import `@tauri-apps` |
| Frontend seam | `src/lib/tauri.ts`, 1,856 lines, 221 exports |
| Rust deps with no Node equivalent | `tantivy`, `notify`, `trash`, `security-framework`, `pdf-extract`, `ureq`, `objc2` |

Either shape is bad. Rewriting Rust into Node discards the Tantivy index (Node's
realistic alternative is SQLite FTS5 — a capability regression against the
infix-recall superset invariant), the secure-prose egress ledger, and the
`check:ipc` / `check:security` contracts. Keeping Rust as a sidecar under an
Electron shell ships Chromium *and* the Rust binary — undoing the size diet
(DMG 28.9 → 13.2 MB) to land near 100–150 MB — and converts a compile-time-checked
in-process IPC surface into a local socket protocol, in a product whose threat
model explicitly names hostile local processes.

## The one thing Electron would genuinely buy

**One rendering engine on all three OSes.** macOS is decided (above) and Windows
is a tie (WebView2 is evergreen Chromium). **Linux is the real exposure**: Tauri
renders there in WebKit2GTK, whose documented weaknesses — large-DOM slowdown,
`contenteditable` quirks, animations blurring the app, canvas/WebGL silently
landing on a software rasterizer — intersect exactly with rotli's three heaviest
surfaces (CodeMirror 6, Excalidraw, Univer).

That is a real risk and it is **not settled by this document**. It is settled by
one day of work: build a Linux AppImage and drive the real editor, a board, and a
sheet in a VM. See the addendum in `cross-platform-feasibility.md`. If that test
fails, the answer is still not a full migration — the options are ship-degraded,
wait for Verso/CEF, or a Linux-only alternative shell over the same Rust core,
which the single frontend seam makes possible.

## Not doing

Electron migration · an Electron hedge shell built speculatively · gating chat on
thermal state (see the local-model plan, which refuses it) · touching
`probe_thermal_ok` (reserved by that plan's PR 2).

## Related

- `cross-platform-feasibility.md` — seam inventory + the 2026-08-06 audit addendum
- `local-model-quality-and-performance.md` — where the joules actually are
- `local-compute-guardrails.md` — admission control for local inference
