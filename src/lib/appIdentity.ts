/** Which app this build is. The same shell builds the standalone Rotli
 * (`com.rotli.app`) and, with a host (src/host/registry.ts), an app under
 * another bundle ID. Rust reads the same identifier
 * (src-tauri/src/app_identity.rs); this side only decides what a person sees.
 * State that two installed apps would share (the update feed, the Keychain,
 * OS-wide shortcuts, the Finder quick action, existing vaults) belongs to the
 * standalone build. Rust alone refuses an existing vault, in the host's words. docs/architecture/host-seams.md */

export const STANDALONE_IDENTIFIER = "com.rotli.app";

/** The bundle ID as a build resolves it: a host names it outright in
 * ROTLI_APP_IDENTIFIER, else the Tauri CLI's `--config` overlay (TAURI_CONFIG),
 * else `tauri.conf.json`. vite.config.ts calls this at build time;
 * src-tauri/build.rs applies the same rule for Rust. */
export function bundleIdentifier(
  named: string | undefined,
  overlay: string | undefined,
  baseConfig: string,
): string {
  const read = (json: string | undefined): string | null => {
    if (!json) return null;
    try {
      const value: unknown = JSON.parse(json);
      const id =
        typeof value === "object" && value !== null ? (value as { identifier?: unknown }).identifier : null;
      return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  };
  const identifier = (named && named.length > 0 ? named : null) ?? read(overlay) ?? read(baseConfig);
  if (!identifier) throw new Error("tauri.conf.json names no identifier");
  if (!/^[A-Za-z0-9.-]+$/.test(identifier))
    throw new Error(`Invalid bundle identifier ${JSON.stringify(identifier)}`);
  return identifier;
}

// Vite replaces this at build time (vite.config.ts `define`).
declare const __ROTLI_APP_IDENTIFIER__: string | undefined;

export const APP_IDENTIFIER: string =
  typeof __ROTLI_APP_IDENTIFIER__ !== "undefined" ? __ROTLI_APP_IDENTIFIER__ : STANDALONE_IDENTIFIER;

/** Only the standalone build uses state two installed apps would share; any
 * other identifier fails closed. */
export function ownsSharedStateFor(identifier: string): boolean {
  return identifier === STANDALONE_IDENTIFIER;
}

export const OWNS_SHARED_STATE = ownsSharedStateFor(APP_IDENTIFIER);

/** Shown instead of the app when the front end and the running app disagree
 * on which app this is. */
export const IDENTITY_MISMATCH =
  "This window was built for a different app than the one running it, so it won't open. Rebuild the app.";

/** Whether the front end may start: the identifier it was built with
 * (APP_IDENTIFIER, the standalone one when a bundle's Vite config left the
 * define out) must be the one the running app reports. Rust already exits
 * when its own compiled ID differs from that runtime ID, so all three agree
 * or nothing runs. A lookup that fails is a mismatch. */
export async function identityHolds(built: string, runtime: () => Promise<string>): Promise<boolean> {
  try {
    return (await runtime()) === built;
  } catch {
    return false;
  }
}
