import { expect, test } from "bun:test";

import { appExtrasSnapshot, hydrateAppExtras } from "./appExtras";
import { useVaultView } from "./vaultView";

test("the Vault view is off by default and kept in the app settings on this Mac", () => {
  hydrateAppExtras("{}");
  expect(useVaultView.getState().on).toBe(false);
  hydrateAppExtras(JSON.stringify({ vaultView: true }));
  expect(useVaultView.getState().on).toBe(true);
  expect(appExtrasSnapshot().vaultView).toBe(true);
  hydrateAppExtras(JSON.stringify({ vaultView: "yes" }));
  expect(useVaultView.getState().on).toBe(false);
});
