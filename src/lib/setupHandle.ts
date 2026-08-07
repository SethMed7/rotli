/** Mounted onboarding/activation owns one primary action. The central key
 * registry routes ⌘Enter here so setup never installs a parallel command
 * listener. Choice groups still own standard radio-arrow semantics locally. */
export interface SetupHandle {
  continue(): void;
}

let current: SetupHandle | null = null;

export function setSetupHandle(handle: SetupHandle | null): void {
  current = handle;
}

export function setupHandle(): SetupHandle | null {
  return current;
}
