/** Desktop-compatible FNV-1a 64 revision of exact UTF-8 text. */
export function contentRevision(text: string): string {
  return bytesRevision(new TextEncoder().encode(text));
}

/** The same desktop revision over raw bytes, including binary files. */
export function bytesRevision(bytes: Uint8Array): string {
  // Four 16-bit words avoid a BigInt operation for each byte of a large file.
  let v0 = 0x2325;
  let v1 = 0x8422;
  let v2 = 0x9ce4;
  let v3 = 0xcbf2;
  for (const byte of bytes) {
    v0 ^= byte;
    const t0 = v0 * 0x1b3;
    let t1 = v1 * 0x1b3;
    let t2 = v2 * 0x1b3 + (v0 << 8);
    const t3 = v3 * 0x1b3 + (v1 << 8);
    t1 += t0 >>> 16;
    v0 = t0 & 0xffff;
    t2 += t1 >>> 16;
    v1 = t1 & 0xffff;
    v3 = (t3 + (t2 >>> 16)) & 0xffff;
    v2 = t2 & 0xffff;
  }
  const word = (v: number) => v.toString(16).padStart(4, "0");
  return `fnv1a64:${word(v3)}${word(v2)}${word(v1)}${word(v0)}`;
}
