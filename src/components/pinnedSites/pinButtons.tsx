// The pinned sites' buttons in the title bar, left of the globe (the owner,
// 2026-10-01: "they can go up here … to the left of the browser"). Each opens
// its site in the panel; pressed while that panel shows.

import { pinMark } from "../../lib/pinnedSites";
import { togglePin } from "../../services/pinnedSites";
import { usePinnedSites } from "../../state/pinnedSites";

export function PinButtons() {
  const sites = usePinnedSites((s) => s.sites);
  const open = usePinnedSites((s) => s.open);
  const supported = usePinnedSites((s) => s.supported);
  if (!supported || sites.length === 0) return null;
  return (
    <>
      {[...sites]
        .sort((a, b) => a.slot - b.slot)
        .map((site) => (
          <button
            type="button"
            key={site.id}
            className={open === site.id ? "icobtn pin-btn railon" : "icobtn pin-btn"}
            aria-label={`Open ${site.label}`}
            aria-pressed={open === site.id}
            title={site.label}
            onClick={() => togglePin(site.id)}
          >
            <span className="pin-mark" aria-hidden="true">
              {pinMark(site.label)}
            </span>
          </button>
        ))}
    </>
  );
}
