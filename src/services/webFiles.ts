// Rotli Web's image lane. The Mac app keeps a dropped image as a file under
// the vault's `storage/images/` and the editor shows it through the asset
// protocol. On the web the same file lands in the connected folder (or the
// imported copy), and in browser-storage mode in the browser vault under
// `asset:<path>`; either way the note keeps the same portable `storage:` link
// the app writes, and the image is shown through an object URL made from the
// stored bytes.

import { bytesFromBase64 } from "../documents/images";
import type { BrowserVault } from "../lib/browserVault";
import { CHAT_IMAGE_ASSET_MAX_BYTES } from "../lib/chatWork";
import { IMAGE_EXTS, imageMimeOf } from "../lib/fileKind";
import type { WebFileStoreShape } from "../lib/webAiSeam";
import { strictExtOf } from "./storageTree";
import type { VaultDir } from "./vaultDir";

// what the app's drop lane accepts (editor NATIVE_IMAGE_EXTS): raster + svg/ico
const WEB_IMAGE_EXTS = new Set([...IMAGE_EXTS, "svg", "ico"]);

/** Where the app files an imported image (corpus.rs `create_image_asset`):
 * every vault the app opens is a memex, so this is the one folder. */
export const ASSET_FOLDER = "storage/images";

const ASSET_KEY = (rel: string) => `asset:${rel}`;

/** A file the web keeps as bytes rather than text (the walk and the zip). */
export function isWebImageName(name: string): boolean {
  return WEB_IMAGE_EXTS.has(strictExtOf(name));
}

/** A filename safe to write beside the notes: no separators, no leading dot. */
export function safeAssetName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((c) => c.charCodeAt(0) >= 0x20)
    .join("")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "image";
}

/** `name.png` → `name-2.png` … until `taken` says no: the app's `free_name`
 * rule for binaries (a `(2)` would break the Markdown image link). */
export function freeName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error("no free name");
}

/** Browser storage cannot list a folder: probe the names freeName would try. */
async function takenInBrowser(kv: BrowserVault, name: string): Promise<Set<string>> {
  const taken = new Set<string>();
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; (await kv.read(ASSET_KEY(`${ASSET_FOLDER}/${candidate}`))) !== undefined; n += 1) {
    taken.add(candidate.toLowerCase());
    candidate = `${stem}-${n}${ext}`;
  }
  return taken;
}

/** The file lane over a folder (live or imported) or, without one, the browser vault. */
export function createWebFileStore(dir: VaultDir | null, kv: () => BrowserVault): WebFileStoreShape {
  // one import at a time: two drops in flight must not both pick the same free name
  let queue: Promise<unknown> = Promise.resolve();
  const readBytes = async (rel: string): Promise<Uint8Array | null> => {
    if (dir) return (await dir.exists(rel)) ? dir.readBytes(rel) : null;
    const stored = await kv().read(ASSET_KEY(rel));
    return stored === undefined ? null : bytesFromBase64(stored);
  };
  const store = async (name: string, base64: string): Promise<string> => {
    const safe = safeAssetName(name);
    const ext = strictExtOf(safe);
    if (!WEB_IMAGE_EXTS.has(ext))
      throw new Error(`images must use one of: ${[...WEB_IMAGE_EXTS].join(", ")}`);
    // bound the encoded size before decoding, as the app does (corpus_create_image_asset)
    if (base64.length > (CHAT_IMAGE_ASSET_MAX_BYTES * 4) / 3 + 8)
      throw new Error("image is larger than 25 MB");
    const bytes = bytesFromBase64(base64);
    if (bytes.byteLength > CHAT_IMAGE_ASSET_MAX_BYTES) throw new Error("image is larger than 25 MB");
    // names compare case-blind: the connected folder may sit on a case-insensitive disk
    const taken = dir
      ? new Set(
          ((await dir.exists(ASSET_FOLDER)) ? await dir.list(ASSET_FOLDER) : []).map((e) =>
            e.name.toLowerCase(),
          ),
        )
      : await takenInBrowser(kv(), safe);
    const chosen = freeName(safe, (candidate) => taken.has(candidate.toLowerCase()));
    const rel = `${ASSET_FOLDER}/${chosen}`;
    if (dir) await dir.writeBytes(rel, bytes);
    else await kv().write(ASSET_KEY(rel), base64);
    return rel;
  };
  return {
    createImageAsset(_rootId, name, base64) {
      const next = queue.then(() => store(name, base64));
      queue = next.catch(() => {});
      return next;
    },
    // no cache here: the editor keeps one url per (root, src) for the session
    async imageUrl(rel) {
      // a `storage:` link may name a legacy `Storage/` file (case-insensitive disk)
      const candidates = [rel, rel.replace(/^storage\//, "Storage/")];
      for (const candidate of candidates) {
        const bytes = await readBytes(candidate);
        if (!bytes) continue;
        const type = imageMimeOf(strictExtOf(candidate));
        return URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }));
      }
      return "";
    },
  };
}
