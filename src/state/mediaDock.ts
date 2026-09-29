// The browser tab tucked into the sidebar player (2026-09-28, the owner:
// "collapse one audio tab … into the media player"): its page keeps playing
// with no tab showing it. One at a time. Session state only.

import { create } from "zustand";

export const useMediaDock = create<{ tabId: string | null }>(() => ({ tabId: null }));
