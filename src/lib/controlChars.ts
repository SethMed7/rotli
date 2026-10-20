// UTF-16 code-unit predicates for the control characters untrusted text is
// scrubbed of. Every code here is in the BMP and outside the surrogate range,
// so a code-unit walk and a code-point walk give the same answer.

/** C0 controls other than tab, line feed, and carriage return. */
export function isNonWhitespaceC0(code: number): boolean {
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
}

/** C0 controls, DEL, and C1 controls. */
export function isC0OrC1Control(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Bidi embeddings, overrides (U+202A–U+202E), and isolates (U+2066–U+2069). */
export function isBidiControl(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}
