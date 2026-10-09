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

/** Split the body into direct children, so paragraphs can change while tables,
 * drawings, content controls, and section properties remain byte-for-byte. */
export function topLevelNodes(body: string): string[] {
  const nodes: string[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf("<", cursor);
    if (start < 0) break;
    if (body.startsWith("<!--", start)) {
      const end = body.indexOf("-->", start + 4);
      if (end < 0) break;
      nodes.push(body.slice(start, end + 3));
      cursor = end + 3;
      continue;
    }
    const open = /^<([\w:-]+)\b[^>]*>/i.exec(body.slice(start));
    if (!open) {
      cursor = start + 1;
      continue;
    }
    const tag = open[1];
    const openText = open[0];
    if (!tag) break;
    if (/\/\s*>$/.test(openText)) {
      nodes.push(openText);
      cursor = start + openText.length;
      continue;
    }
    const token = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}\\s*>`, "gi");
    token.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (;;) {
      const match = token.exec(body);
      if (!match) break;
      if (match[0].startsWith("</")) depth -= 1;
      else if (!/\/\s*>$/.test(match[0])) depth += 1;
      if (depth === 0) {
        end = token.lastIndex;
        break;
      }
    }
    if (end < 0) break;
    nodes.push(body.slice(start, end));
    cursor = end;
  }
  return nodes;
}

export function innerXml(xml: string, tag: string): string {
  return new RegExp(`<w:${tag}\\b[^>]*>([\\s\\S]*?)<\\/w:${tag}>`, "i").exec(xml)?.[1] ?? "";
}
