// Settings → General → Ambient audio → Your YouTube stations (the owner,
// 2026-10-01: "offer option to add another url, must be youtube, for people
// to add their own yt fm music they like"). Up to three; each plays like
// Claude FM, in the hidden page, from the rebuilt address only.

import { useState } from "react";

import { type AmbientPrefs, DEFAULT_AMBIENT } from "../../lib/ambient";
import { MAX_STATIONS, parseYouTubeLink, stationTitle } from "../../lib/youtubeStation";
import { AddField, AddRow, EntryProblem, NameField, RemovableRows } from "./removableList";

/** Why a pasted link can't be added, or null when it can. */
export function stationProblem(link: string, prefs: Pick<AmbientPrefs, "stations">): string | null {
  if (prefs.stations.length >= MAX_STATIONS)
    return `You can keep ${MAX_STATIONS} stations; remove one first.`;
  const parsed = parseYouTubeLink(link);
  if (!parsed) return "That isn’t a YouTube video, live stream, or playlist link.";
  if (prefs.stations.some((station) => station.id === parsed.id)) return "That station is already here.";
  return null;
}

/** Adding a station also plays it; removing the one playing goes back to Linen. */
export function addedStation(link: string, name: string, prefs: AmbientPrefs): Partial<AmbientPrefs> | null {
  const parsed = parseYouTubeLink(link);
  if (!parsed || stationProblem(link, prefs)) return null;
  return {
    stations: [...prefs.stations, { ...parsed, title: stationTitle(name) }],
    track: parsed.id,
    playing: true,
  };
}

export function removedStation(id: string, prefs: AmbientPrefs): Partial<AmbientPrefs> {
  const stations = prefs.stations.filter((station) => station.id !== id);
  return prefs.track === id ? { stations, track: DEFAULT_AMBIENT.track } : { stations };
}

export function YouTubeStations({
  prefs,
  setPrefs,
}: {
  prefs: AmbientPrefs;
  setPrefs: (change: Partial<AmbientPrefs>) => void;
}) {
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const why = stationProblem(link, prefs);
    setProblem(why);
    const change = why ? null : addedStation(link, name, prefs);
    if (!change) return;
    setPrefs(change);
    setLink("");
    setName("");
  };
  return (
    <div className="rules-list yt-stations">
      <h5 className="set-subhead">Your YouTube stations</h5>
      <p className="setnote">
        Add up to {MAX_STATIONS} YouTube videos, live streams, or playlists. They play like Claude FM, in a
        private page you don’t see, so they need the internet and YouTube may show ads.
      </p>
      <RemovableRows
        label="Your YouTube stations"
        rows={prefs.stations.map((station) => ({ key: station.id, text: station.title, title: station.url }))}
        onRemove={(id) => setPrefs(removedStation(id, prefs))}
      />
      {prefs.stations.length < MAX_STATIONS && (
        <AddRow disabled={!link.trim()} onAdd={add}>
          <AddField
            aria-label="YouTube link"
            placeholder="Paste a YouTube link"
            value={link}
            onChange={(event) => {
              setLink(event.currentTarget.value);
              setProblem(null);
            }}
          />
          <NameField label="Station name" value={name} onChange={setName} />
        </AddRow>
      )}
      <EntryProblem problem={problem} />
    </div>
  );
}
