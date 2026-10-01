// Settings → Browser → Pinned sites (docs/decisions/2026-10-01-pinned-sites.md):
// up to three https sites, each a button left of the globe that opens it,
// signed in, in a panel. Removing one signs it out.

import { useState } from "react";

import { MAX_PINS, pinProblem } from "../../lib/pinnedSites";
import { addPin, canAddPins, removePin } from "../../services/pinnedSites";
import { usePinnedSites } from "../../state/pinnedSites";
import { AddField, AddRow, EntryProblem, NameField, RemovableRows } from "./removableList";

export function PinnedSitesSettings() {
  const sites = usePinnedSites((s) => s.sites);
  const supported = usePinnedSites((s) => s.supported);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const why = pinProblem(link, sites);
    setProblem(why);
    if (why || !addPin(name, link)) return;
    setLink("");
    setName("");
  };
  return (
    <div className="rules-list pinned-sites">
      <h4 className="sethead">Pinned sites</h4>
      <p className="setnote">
        Pin up to {MAX_PINS} sites you sign in to. Each gets a button in the title bar, left of the globe, and
        opens in a panel instead of a tab. You stay signed in; each site keeps its own sign-in, apart from the
        others and from private pages. Removing a site signs you out of it.
      </p>
      {supported === false && <p className="setnote">Pinned sites need macOS 14 or later.</p>}
      <>
        {/* a saved pin can always be removed, whatever this Mac supports */}
        <RemovableRows
          label="Pinned sites"
          rows={sites.map((site) => ({ key: site.id, text: site.label, title: site.url }))}
          onRemove={(id) =>
            void removePin(id).catch((error: unknown) =>
              setProblem(`Couldn’t remove it: ${error instanceof Error ? error.message : String(error)}`),
            )
          }
        />
        {canAddPins(supported) && sites.length < MAX_PINS && (
          <AddRow disabled={!link.trim()} onAdd={add}>
            <AddField
              aria-label="Site address"
              placeholder="https://x.com"
              value={link}
              onChange={(event) => {
                setLink(event.currentTarget.value);
                setProblem(null);
              }}
            />
            <NameField label="Site name" value={name} onChange={setName} />
          </AddRow>
        )}
        <EntryProblem problem={problem} />
      </>
    </div>
  );
}
