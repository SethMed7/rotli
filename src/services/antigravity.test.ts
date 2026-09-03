// The Antigravity service is the one door to `antigravity_manage`; every
// action resolves to the lane's status. Outside Tauri (bun test, the browser
// twin) the bridge answers "platform unsupported" so the card renders its
// honest empty state instead of offering an install it cannot perform.
import { describe, expect, test } from "bun:test";

import {
  ANTIGRAVITY_SIGN_IN_REQUEST_ID,
  ANTIGRAVITY_STATUS_KEY,
  antigravityCancelSignIn,
  antigravityInstall,
  antigravityRemove,
  antigravitySignIn,
  antigravitySignOut,
  antigravityStatus,
} from "./antigravity";

describe("antigravity service outside Tauri", () => {
  test("every action resolves to an unsupported, not-installed status", async () => {
    for (const action of [
      antigravityStatus,
      antigravityInstall,
      antigravitySignIn,
      antigravitySignOut,
      antigravityRemove,
    ]) {
      const status = await action();
      expect(status.platformSupported).toBe(false);
      expect(status.installed).toBe(false);
      expect(status.signedIn).toBe(false);
    }
  });

  test("cancelling a sign-in outside Tauri rejects instead of pretending", async () => {
    // the card never shows Cancel here (platform unsupported), and the bridge
    // refuses rather than resolving a cancel it could not deliver
    await expect(antigravityCancelSignIn()).rejects.toBeDefined();
  });

  test("the sign-in request id and the query key are stable contracts", () => {
    // mirrored by src-tauri/src/antigravity.rs SIGN_IN_REQUEST_ID and the
    // settings card's useQuery; a rename on one side must land on both
    expect(ANTIGRAVITY_SIGN_IN_REQUEST_ID).toBe("antigravity:sign-in");
    expect(ANTIGRAVITY_STATUS_KEY).toEqual(["antigravity", "status"]);
  });
});
