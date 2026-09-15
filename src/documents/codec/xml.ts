// Minimal WordprocessingML string helpers shared by the DOCX codec modules.

export function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Characters XML 1.0 forbids outright (C0 controls other than tab, newline,
 * and carriage return; U+FFFE; U+FFFF). One such character written verbatim
 * makes Word reject the whole document, so they are dropped, never escaped. */
function isXmlForbidden(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0xfffe || code === 0xffff
  );
}

function stripXmlForbidden(value: string): string {
  let kept = "";
  for (const char of value) if (!isXmlForbidden(char.codePointAt(0) ?? 0)) kept += char;
  return kept;
}

export function encodeXml(value: string): string {
  return stripXmlForbidden(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function val(xml: string, tag: string): string | undefined {
  return new RegExp(`<w:${tag}\\b[^>]*\\bw:val=["']([^"']*)["'][^>]*\\/?>`, "i").exec(xml)?.[1];
}

export function enabled(xml: string, tag: string): boolean {
  const match = new RegExp(`<w:${tag}\\b([^>]*)\\/?>`, "i").exec(xml);
  if (!match) return false;
  return !/\bw:val=["'](?:0|false|off|none)["']/i.test(match[1] ?? "");
}
