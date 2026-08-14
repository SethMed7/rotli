/**
 * A narrow composition seam for non-editor surfaces that own a local find
 * field (Tasks today). Keyboard policy remains centralized in actions.ts;
 * mounted presentation surfaces only publish the intent they can fulfill.
 */
let activeSurfaceFind: (() => void) | null = null;

export function registerSurfaceFind(handler: () => void): () => void {
  activeSurfaceFind = handler;
  return () => {
    if (activeSurfaceFind === handler) activeSurfaceFind = null;
  };
}

export function runSurfaceFind(): boolean {
  if (!activeSurfaceFind) return false;
  activeSurfaceFind();
  return true;
}
