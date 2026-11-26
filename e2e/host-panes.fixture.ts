// A synthetic host for host-panes.spec.ts, which loads it ahead of the app. It
// adds a pane of links and a pane gated on a capability the spec can flip.

import { createElement as h, useState } from "react";
import { create } from "zustand";

import { type HostPaneProps, registerHost } from "../src/host/registry";

const useCapability = create<{ ready: boolean }>(() => ({ ready: true }));
let listening = 0;

function Links({ openPane }: HostPaneProps) {
  const [refused, setRefused] = useState("");
  const link = (id: string) =>
    h(
      "button",
      {
        type: "button",
        key: id,
        onClick: () => {
          try {
            openPane(id);
          } catch (error) {
            setRefused(String(error));
          }
        },
      },
      `Open ${id}`,
    );
  return h("div", null, ["connections", "gated", "links", "nowhere"].map(link), h("output", null, refused));
}

const Gated = () => h("button", { type: "button" }, "Inside the gated pane");

/** What the spec drives the host with. */
export interface SyntheticHost {
  setReady: (ready: boolean) => void;
  /** How many of Settings' visibility subscriptions are live. */
  listening: () => number;
}

const driver: SyntheticHost = {
  setReady: (ready) => useCapability.setState({ ready }),
  listening: () => listening,
};
Object.assign(window, { syntheticHost: driver });

const glyph = () => null;
registerHost({
  words: { productName: "Synthetic" },
  settingsPanes: [
    { id: "links", label: "Links", glyph, Pane: Links, after: "general" },
    {
      id: "gated",
      label: "Gated",
      glyph,
      Pane: Gated,
      visible: () => useCapability.getState().ready,
      subscribeVisible: (onChange) => {
        listening += 1;
        const stop = useCapability.subscribe(onChange);
        return () => {
          listening -= 1;
          stop();
        };
      },
    },
  ],
});
