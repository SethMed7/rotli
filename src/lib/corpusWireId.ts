declare const pathIdBrand: unique symbol;

/** A wire id that IS a file's (root-prefixed) relative path: a board, a
 * document, a sheet, or a note opened by path. Only these ids change when a
 * file is renamed or filed — a `.md` note's frontmatter ULID survives every
 * move — so the rename/retarget APIs take PathId and a plain id cannot be
 * passed to them by mistake. A string at runtime; the brand is compile-time. */
export type PathId = string & { readonly [pathIdBrand]: true };

/** Mark an id the caller knows to be a path id (a board/file id, or a rel path
 * the corpus reported). No runtime check — the brand records where it came from. */
export function pathId(id: string): PathId {
  return id as PathId;
}

/** The corpus root a wire id belongs to ("default" for bare ids). */
export function rootIdOf(id: string): string {
  return splitRootId(id).rootId;
}

/** Split a corpus wire id into its root and relative path. Mirrors Rust's
 * `split_root_id`; the default root emits bare relative paths. */
export function splitRootId(id: string): { rootId: string; rel: string } {
  const i = id.indexOf(":");
  if (i > 0 && !id.slice(0, i).includes("/")) {
    return { rootId: id.slice(0, i), rel: id.slice(i + 1) };
  }
  return { rootId: "default", rel: id };
}
