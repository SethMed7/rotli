// Rotli Web's "Connect a folder" dialog: one open flag, asked from the
// sidebar's Connect vault and from Settings → General. Session state only.

import { createOpenFlagStore } from "./openFlag";

export const useWebVaultConnect = createOpenFlagStore();
