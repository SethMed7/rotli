// Remembered embed heights (Seth, 2026-07-29: "when I resize an embedded
// Excalidraw board it should remember"). Keyed by the embed's file id, so the
// height survives the widget rebuilds that reveal-on-caret causes AND app
// restarts. UI preference only — rebuildable, never part of the note's text
// (the fence grammar stays a bare file id).

const STORE_KEY = "rotli.embedHeights.v1";
const CAP = 200;

function load(): Map<string, number> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed.filter(
        (e): e is [string, number] =>
          Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number",
      ),
    );
  } catch {
    return new Map();
  }
}

const heights = load();

export function rememberedEmbedHeight(fileId: string): number | null {
  return heights.get(fileId) ?? null;
}

export function rememberEmbedHeight(fileId: string, height: number): void {
  heights.delete(fileId); // re-insert = LRU touch
  heights.set(fileId, Math.round(height));
  while (heights.size > CAP) {
    const oldest = heights.keys().next().value;
    if (oldest === undefined) break;
    heights.delete(oldest);
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...heights.entries()]));
  } catch {
    /* quota/private-mode — the in-memory map still serves this session */
  }
}
