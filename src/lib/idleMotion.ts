/** Park CSS animation while the window is put away.
 *
 * Chromium suspends rAF and throttles timers for an occluded renderer; WKWebView
 * does not make the same promise, and WebKitGTK is worse still — a playing
 * animation there is documented to degrade the rest of the app. rotli is a
 * menu-bar app, so its window spends most of its life tucked away: any
 * always-on animation would be composited for hours that nobody watches. Every
 * public Tauri "200% CPU while idle" report is this exact bug.
 *
 * Rather than ask each animation to opt in, stamp the document once and let a
 * single rule in base.css pause all of them (`:root[data-idle="hidden"]`), so an
 * animation added years from now inherits the behavior for free.
 *
 * Measured on macOS 2026-08-06 (M4 Max, 240 animating elements in a WKWebView
 * harness): no delta detectable in the app's own processes between animating,
 * hidden, and paused — compositing lands in WindowServer, which cannot be
 * attributed on a machine in use. So this is a regression guard and Linux
 * insurance, not a macOS speedup, and it is documented as such in
 * docs/design/shell-runtime-decision.md. What *is* verified on macOS: the
 * Page Visibility state really does flip to "hidden" when a window is ordered
 * out and the app hidden, which is how rotli tucks its window away.
 */

/** The slice of `document` this needs — small enough that a test can pass a
 * stand-in, since `bun test` runs without a real DOM (see test-setup.ts). */
export type IdleMotionDoc = {
  hidden: boolean;
  documentElement: {
    setAttribute: (name: string, value: string) => void;
    removeAttribute: (name: string) => void;
  };
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
};

export const IDLE_ATTRIBUTE = "data-idle";
export const IDLE_HIDDEN = "hidden";

/** Stamp `data-idle="hidden"` on <html> whenever the page is hidden, and clear
 * it when it comes back. Returns the detach function. Safe to call in any
 * window (main, capture, quick) — each has its own document. */
export function attachIdleMotion(doc?: IdleMotionDoc): () => void {
  const target = doc ?? (globalThis as unknown as { document?: IdleMotionDoc }).document;
  if (!target?.documentElement) return () => {};

  const apply = () => {
    if (target.hidden) target.documentElement.setAttribute(IDLE_ATTRIBUTE, IDLE_HIDDEN);
    else target.documentElement.removeAttribute(IDLE_ATTRIBUTE);
  };

  apply();
  target.addEventListener("visibilitychange", apply);
  return () => target.removeEventListener("visibilitychange", apply);
}
