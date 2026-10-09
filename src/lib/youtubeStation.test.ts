import { expect, test } from "bun:test";

import {
  DEFAULT_STATION_TITLE,
  MAX_STATIONS,
  parseStations,
  parseYouTubeLink,
  stationTitle,
} from "./youtubeStation";

const V = "jfKfPfyJRdk";
const L = "PLOGi5-fAu8bHGZ6S7SnzKpCBdlQ9bDAkA";

test("a video link in any of YouTube's shapes becomes one www.youtube.com address", () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${V}`,
    `youtube.com/watch?v=${V}&t=42s`,
    `https://m.youtube.com/watch?v=${V}`,
    `https://music.youtube.com/watch?v=${V}`,
    `https://youtu.be/${V}?si=share`,
    `https://www.youtube.com/live/${V}`,
    `https://www.youtube.com/shorts/${V}`,
    `https://www.youtube.com/embed/${V}`,
    `  http://youtube.com/watch?v=${V}  `,
  ]) {
    expect(parseYouTubeLink(link)).toEqual({ id: `yt-${V}`, url: `https://www.youtube.com/watch?v=${V}` });
  }
});

test("a playlist keeps its list, with or without a starting video", () => {
  expect(parseYouTubeLink(`https://www.youtube.com/watch?v=${V}&list=${L}`)).toEqual({
    id: `yt-${V}`,
    url: `https://www.youtube.com/watch?v=${V}&list=${L}`,
  });
  expect(parseYouTubeLink(`https://www.youtube.com/playlist?list=${L}`)).toEqual({
    id: `yt-list-${L}`,
    url: `https://www.youtube.com/watch?list=${L}`,
  });
});

test("anything that isn't a YouTube video or playlist is refused", () => {
  for (const link of [
    "",
    "not a link",
    `https://youtube.com.evil.test/watch?v=${V}`,
    `https://evil.test/?u=https://www.youtube.com/watch?v=${V}`,
    `https://vimeo.com/${V}`,
    `javascript:alert(1)//youtube.com/watch?v=${V}`,
    `file:///youtube.com/watch?v=${V}`,
    "https://www.youtube.com/@lofigirl",
    "https://www.youtube.com/watch?v=short",
    `https://www.youtube.com/watch?v=${V}<script>`,
    "https://www.youtube.com/playlist?list=bad list",
  ]) {
    expect(parseYouTubeLink(link)).toBeNull();
  }
});

test("a station's name is trimmed, bounded, and never empty", () => {
  expect(stationTitle("  Lofi   girl ")).toBe("Lofi girl");
  expect(stationTitle("x".repeat(80))).toHaveLength(40);
  expect(stationTitle("   ")).toBe(DEFAULT_STATION_TITLE);
  expect(stationTitle(7)).toBe(DEFAULT_STATION_TITLE);
});

test("saved stations are parsed again: other hosts, duplicates, and extras drop", () => {
  const saved = [
    { url: `https://youtu.be/${V}`, title: "Mine" },
    { url: `https://www.youtube.com/watch?v=${V}`, title: "Same video again" },
    { url: "https://evil.test/watch?v=jfKfPfyJRdk", title: "Elsewhere" },
    { title: "No address" },
    "junk",
    { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" },
    { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" },
    { url: "https://www.youtube.com/watch?v=ccccccccccc" },
  ];
  const stations = parseStations(saved);
  expect(stations).toHaveLength(MAX_STATIONS);
  expect(stations[0]).toEqual({ id: `yt-${V}`, title: "Mine", url: `https://www.youtube.com/watch?v=${V}` });
  expect(stations[1]?.title).toBe(DEFAULT_STATION_TITLE);
  expect(stations.map((station) => station.id)).not.toContain("yt-ccccccccccc");
  expect(parseStations("nope")).toEqual([]);
});
