// What the person hid from Rotli's chrome (src/lib/hideable.ts), kept in the
// app settings on this Mac (state/appExtras.ts).

import { create } from "zustand";

import type { HideId, Hidden } from "../lib/hideable";

export const useHidden = create<{ hidden: Hidden; setShown: (id: HideId, shown: boolean) => void }>(
  (set) => ({
    hidden: {},
    setShown: (id, shown) =>
      set((s) => {
        const { [id]: _was, ...rest } = s.hidden;
        return { hidden: shown ? rest : { ...rest, [id]: true } };
      }),
  }),
);

/** Whether one item is hidden. */
export const useIsHidden = (id: HideId): boolean => useHidden((s) => s.hidden[id] === true);

export function showEverything(): void {
  useHidden.setState({ hidden: {} });
}
