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
