// Rotli Web's "Chat on the web" walkthrough: one open flag, asked from the
// sidebar's Chat front and from the note editor's chat chip. Session state only.

import { createOpenFlagStore } from "./openFlag";

export const useChatSetupGuide = createOpenFlagStore();
