// The single registry of every hotkey-driven action, and the ONE keydown
// dispatcher per webview that routes to it (attached once in App.tsx). No
// ad-hoc keydown listeners anywhere else — text inputs may handle their own
// typing, but every command chord lives here, and every chord is rebindable
// (the overrides map lives in the bindings store; defaults live here).
// Global chords are registered with the OS in Rust; rebinding them round-trips
// through the set_summon_shortcut invoke.

import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { emitRebind, setGlobalShortcut } from "../lib/tauri";
import { resolveChord, useBindingsStore } from "./bindings";
import { chordFromEvent, normalizeChord, toAccelerator } from "./chords";
import { EDITOR_ACTION } from "./editorActionIds";
import { leaderConsumes } from "./leader";

/** Which webview an action belongs to — the dispatcher only fires actions for
 * its own surface (global actions are handled OS-side in Rust and skipped).
 * "quick" is the floating Quick Note window; "chat" is Chat pulled out into its
 * own window. */
export type Surface = "main" | "capture" | "quick" | "chat";

export interface KeyAction {
  id: string;
  title: string;
  /** Default chord like "Esc", "Alt+Space", "Meta+0"; null = unbound. */
  defaultChord: string | null;
  surface: Surface;
  /** OS-wide shortcut, registered + handled in Rust — the dispatcher skips it. */
  global?: boolean;
  /** Fires on EVERY surface's dispatcher — for actions tied to a per-webview
   * seam that exists wherever it's mounted (the editor.* format commands resolve
   * through activeEditor(), so they belong to the main AND quick windows). Like
   * global, a shared chord conflicts across surfaces. */
  shared?: boolean;
  /** Extra surfaces this action ALSO fires on (alsoOnSurface). Narrower than
   * `shared`, which would fire in Quick and Capture too: the Chat window wants
   * main's tab and pane chords and none of its note commands. */
  also?: Surface[];
  /** Other words ⌘K finds it by ("send to AI" for Hand to AI, 2026-09-28). */
  keywords?: readonly string[];
  /** Runtime availability for transient surfaces such as first-run setup. */
  enabled?: () => boolean;
  /** Registered for dispatch but omitted from Settings/⌘K/shortcut maps. */
  transient?: boolean;
  /** Stands down inside a text field even with a modifier held: ⌘← is
   * "line start" in an input and must stay so (the nav.*.arrow chords). */
  unlessEditable?: boolean;
  run: () => void;
}

type KeyActionInput = Omit<KeyAction, "surface"> & { surface?: Surface };

const actions = new Map<string, KeyAction>();

export function registerAction(action: KeyActionInput): void {
  actions.set(action.id, { surface: "main", ...action });
}

/** Let an already-registered action fire on one more surface. */
export function alsoOnSurface(id: string, surface: Surface): void {
  const action = actions.get(id);
  if (action) actions.set(id, { ...action, also: [...(action.also ?? []), surface] });
}

export function getAction(id: string): KeyAction | undefined {
  return actions.get(id);
}

export function allActions(): KeyAction[] {
  return [...actions.values()].filter((action) => !action.transient);
}

export function dispatch(actionId: string): void {
  actions.get(actionId)?.run();
}

/** Chords Rotli Web keeps: the editor's text formatting (⌘B, ⌘I…), which a
 * web editor is expected to answer. */
const WEB_KEPT_CHORDS: ReadonlySet<string> = new Set(Object.values(EDITOR_ACTION));

/** The action's chord right now: override if one exists, else its default.
 * Where the build withholds app hotkeys (Rotli Web), a modifier chord is none
 * — nothing dispatches it and no hint shows it — unless it formats text; bare
 * keys (Esc, Enter) still answer. */
export function currentChord(actionId: string): string | null {
  const action = actions.get(actionId);
  if (!action) return null;
  const chord = resolveChord(useBindingsStore.getState().overrides, actionId, action.defaultChord);
  return chordInBuild(chord, actionId, LAUNCH_FEATURES.hotkeys);
}

/** The rule above, pure: a modifier chord is withheld where the build has no
 * app hotkeys, unless it formats text. */
export function chordInBuild(chord: string | null, actionId: string, hotkeys: boolean): string | null {
  if (chord && !hotkeys && chord.includes("+") && !WEB_KEPT_CHORDS.has(actionId)) return null;
  return chord;
}

/** A chord the Mac app would claim right now — same surface and `enabled`
 * rules as claimingAction — that Rotli Web leaves to the browser (⌘[, ⌘]…).
 * The editor's own keymap steps aside for it, so a web note never
 * re-purposes a key the app reserves (review of #66: ⌘[ indented), while a
 * chord the app only claims sometimes (⌘⌫ with a System selection, ⌘⏎ in
 * setup or capture) still reaches the editor when unclaimed. */
export function webFreedChord(pressed: string, hotkeys: boolean = LAUNCH_FEATURES.hotkeys): boolean {
  if (hotkeys) return false;
  const overrides = useBindingsStore.getState().overrides;
  for (const action of actions.values()) {
    if (action.global || WEB_KEPT_CHORDS.has(action.id)) continue;
    const here =
      action.shared || action.surface === attachedSurface || action.also?.includes(attachedSurface);
    if (!here) continue;
    if (action.enabled && !action.enabled()) continue;
    const chord = resolveChord(overrides, action.id, action.defaultChord);
    if (chord && chord.includes("+") && normalizeChord(chord) === pressed) return true;
  }
  return false;
}

/** The other action already holding `chord`, if any (for the quiet inline
 * conflict note in Settings → Hotkeys). Each webview runs its own dispatcher,
 * so chords only collide on the SAME surface — or when either side is
 * OS-global (a global chord fires everywhere). */
export function conflictFor(actionId: string, chord: string): KeyAction | null {
  const target = actions.get(actionId);
  if (!target) return null;
  const n = normalizeChord(chord);
  for (const action of actions.values()) {
    if (action.id === actionId) continue;
    // a shared or global chord fires everywhere, so it collides with any
    // surface; otherwise only same-surface chords can collide
    const spansAll = action.global || target.global || action.shared || target.shared;
    if (action.surface !== target.surface && !spansAll) continue;
    const c = currentChord(action.id);
    if (c && normalizeChord(c) === n) return action;
  }
  return null;
}

/** Rebind an action. For global actions the OS registration goes FIRST — only
 * a successful round-trip commits the override (otherwise the UI would show a
 * chord the OS never fires; Rust keeps the old chord registered on failure and
 * the rejection bubbles to the caller for the quiet inline note). `null`
 * unbinds — including OS-side for global actions. */
export async function rebind(actionId: string, chord: string | null): Promise<void> {
  const action = actions.get(actionId);
  if (!action) return;
  if (action.global) await setGlobalShortcut(actionId, chord ? toAccelerator(chord) : null);
  useBindingsStore.getState().setOverride(actionId, chord);
  emitRebind(actionId, chord);
}

/** Apply a rebind that arrived from the other webview (no re-emit, no invoke). */
export function applyRebind(actionId: string, chord: string | null): void {
  useBindingsStore.getState().setOverride(actionId, chord);
}

let detach: (() => void) | null = null;
let attachedSurface: Surface = "main";

let suspended = false;

/** While Settings → Hotkeys records a chord the dispatcher stands down, so a
 * half-recorded combo can never fire a live action under the recorder. */
export function setDispatchSuspended(on: boolean): void {
  suspended = on;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** The chords Excalidraw keeps on its own canvas (boards slice 2026-07-28,
 * widened 2026-10-08). ⌘D duplicates an object, not a pane split; ⌘0/⌘=/⌘−
 * zoom where I am; ⌘F searches the board's text (a board has no note find);
 * ⌘⇧L locks shapes (a board is not a note to secure); ⌘←/⌘→ grow a
 * flowchart. Every OTHER app chord wins over the canvas — ⌘K, ⌘[ / ⌘], ⌘W,
 * ⌘⇧P, ⌘⇧D… — even where Excalidraw has its own meaning for it (⌘K link,
 * ⌘[ ⌘] layer order, ⌘⇧P palette: all still in its menus, and ⌘/ opens its
 * palette). */
const CANVAS_OWNED_CHORDS: ReadonlySet<string> = new Set(
  [
    "Meta+D",
    "Meta+0",
    "Meta+Equal",
    "Meta+Minus",
    "Meta+F",
    "Meta+Shift+L",
    "Meta+ArrowLeft",
    "Meta+ArrowRight",
  ].map(normalizeChord), // a pressed chord is canonical (Shift+Meta+L)
);

function isCanvasTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.closest(".canvas-surface, .rotli-embed-board-inner") !== null
  );
}

/** The action this webview's dispatcher would fire for `pressed` (a normalized
 * chord) right now, or null. The one ownership rule: the dispatcher uses it, and
 * the editor's vendor keymap asks it before running a CodeMirror command on the
 * same chord (src/editor/vendorKeymap.ts). */
export function claimingAction(pressed: string): KeyAction | null {
  if (suspended) return null;
  for (const action of actions.values()) {
    if (action.global) continue; // OS-side, handled in Rust
    const here =
      action.shared || action.surface === attachedSurface || action.also?.includes(attachedSurface);
    if (!here) continue;
    if (action.enabled && !action.enabled()) continue;
    const chord = currentChord(action.id);
    if (chord && normalizeChord(chord) === pressed) return action;
  }
  return null;
}

/** A chord with a command modifier — the ones a canvas must not swallow. Bare
 * keys (Esc, Enter, arrows, tool letters) stay the canvas's first. */
function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/** Attach the one dispatcher for this webview's surface. Idempotent.
 *
 * It listens twice, with one routing rule. Over a board, Excalidraw answers
 * every chord it knows on its own container and stops it there (⌘K is its
 * link editor, ⌘[ its layer order, ⌘⇧P its palette), so a window listener in
 * the bubble phase never heard them (2026-10-08). Over a canvas the dispatcher
 * therefore takes modifier chords in the CAPTURE phase, before the canvas, and
 * stops the ones it runs; everything else routes in the bubble phase as it
 * always has. */
export function attachDispatcher(surface: Surface): () => void {
  if (detach) return detach;
  attachedSurface = surface;
  /** Route one key press; answers whether the dispatcher consumed it. */
  const route = (event: KeyboardEvent): boolean => {
    if (suspended) return false;
    // a key the editor already consumed (a picker's Escape, a keymap binding)
    // is not a chord press: Esc must unwind the picker, not hide the window
    if (event.defaultPrevented) return false;
    if (event.repeat) return false; // auto-repeat is not a fresh press — never re-fire a command
    const pressed = chordFromEvent(event);
    if (!pressed) return false;
    // a modifier-less chord must never swallow typing: inside editable targets
    // only Esc / Enter / F-keys may dispatch bare (the capture card's ⏎ save,
    // Esc everywhere) — a bare-letter rebind stays typable in text fields
    if (!hasCommandModifier(event) && isEditableTarget(event.target)) {
      const key = pressed.split("+").pop() ?? "";
      if (!/^(Esc|Enter|F\d{1,2})$/.test(key)) return false;
    }
    // a pending two-step hotkey (keys/leader.ts) is offered the key before any
    // action: for that one keystroke ⌘1–9 mean "slot 1–9", not a tab jump.
    // AFTER the typing guard above, so a bare digit typed into the editor or a
    // filter while a leader is pending is still just a digit.
    if (leaderConsumes(pressed)) {
      event.preventDefault();
      return true;
    }
    // over an Excalidraw canvas the clash chords belong to the canvas
    if (CANVAS_OWNED_CHORDS.has(pressed) && isCanvasTarget(event.target)) return false;
    const action = claimingAction(pressed);
    if (!action) return false;
    if (action.unlessEditable && isEditableTarget(event.target)) return false;
    event.preventDefault();
    action.run();
    return true;
  };
  const overCanvas = (event: KeyboardEvent): boolean =>
    hasCommandModifier(event) && isCanvasTarget(event.target);
  const onCapture = (event: KeyboardEvent) => {
    if (!overCanvas(event)) return;
    // Excalidraw's own palette and search listen on window in the capture
    // phase too — only stopImmediatePropagation keeps them from also firing
    if (route(event)) event.stopImmediatePropagation();
  };
  const onBubble = (event: KeyboardEvent) => {
    if (overCanvas(event)) return; // offered in the capture phase already
    route(event);
  };
  window.addEventListener("keydown", onCapture, { capture: true });
  window.addEventListener("keydown", onBubble);
  detach = () => {
    window.removeEventListener("keydown", onCapture, { capture: true });
    window.removeEventListener("keydown", onBubble);
    detach = null;
  };
  return detach;
}
