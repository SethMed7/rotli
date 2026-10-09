// Word hyperlinks Rotli edits: external web and mail links, a
// `<w:hyperlink r:id>` whose relationship is TargetMode="External". An
// in-document anchor (`w:anchor`) or any other target stays unsupported, so
// the codec still refuses to rewrite a paragraph holding one.

import { type DocumentRun, safeLinkUrl } from "../model";
import { decodeXml, encodeXml } from "./xml";

const HYPERLINK_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

/** A `<w:hyperlink …>` open tag (never a self-closed one) and its runs. */
export const HYPERLINK = /<w:hyperlink\b([^>]*?)(?<!\/)>([\s\S]*?)<\/w:hyperlink\s*>/gi;

export interface Hyperlinks {
  /** The link a relationship id names, when Rotli can edit it. */
  url(relationshipId: string): string | undefined;
  /** The relationship id for a link, adding one when the file has none. */
  idFor(url: string): string;
  /** The relationships part with the links added, or null when none were. */
  added(): string | null;
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];
}

export function hyperlinks(relationshipXml: string): Hyperlinks {
  const urls = new Map<string, string>();
  const ids = new Set<string>();
  for (const [tag] of relationshipXml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const id = attribute(tag, "Id");
    if (!id) continue;
    ids.add(id);
    const url = safeLinkUrl(decodeXml(attribute(tag, "Target") ?? ""));
    if (url && attribute(tag, "Type") === HYPERLINK_TYPE && attribute(tag, "TargetMode") === "External")
      urls.set(id, url);
  }
  const byUrl = new Map([...urls].map(([id, url]) => [url, id] as const));
  const fresh: string[] = [];
  return {
    url: (id) => urls.get(id),
    idFor(url) {
      const known = byUrl.get(url);
      if (known) return known;
      let n = 1;
      while (ids.has(`rIdRotliLink${n}`)) n++;
      const id = `rIdRotliLink${n}`;
      ids.add(id);
      urls.set(id, url);
      byUrl.set(url, id);
      fresh.push(
        `<Relationship Id="${id}" Type="${HYPERLINK_TYPE}" Target="${encodeXml(url)}" TargetMode="External"/>`,
      );
      return id;
    },
    added: () =>
      fresh.length
        ? relationshipXml.replace(/<\/Relationships\s*>/i, `${fresh.join("")}</Relationships>`)
        : null,
  };
}

export const NO_HYPERLINKS: Hyperlinks = hyperlinks("");

/** The link a hyperlink's open-tag attributes point at, when Rotli edits it. */
export function hyperlinkUrl(attributes: string, links: Hyperlinks): string | undefined {
  if (/\sw:anchor=/i.test(attributes)) return undefined;
  const id = attribute(attributes, "r:id");
  return id ? links.url(id) : undefined;
}

/** True when a paragraph holds a hyperlink Rotli can't rewrite. */
export function hasForeignHyperlink(paragraphXml: string, links: Hyperlinks): boolean {
  const opens = [...paragraphXml.matchAll(/<w:hyperlink\b([^>]*)>/gi)];
  return opens.some((open) => open[0].endsWith("/>") || !hyperlinkUrl(open[1] ?? "", links));
}

/** Runs as XML, each stretch of runs sharing a link inside one `<w:hyperlink>`. */
export function linkedRunsXml(
  runs: readonly DocumentRun[],
  links: Hyperlinks,
  runXml: (run: DocumentRun, index: number) => string,
): string {
  let xml = "";
  for (let index = 0; index < runs.length;) {
    const link = runs[index]?.link;
    let group = "";
    for (; index < runs.length && runs[index]?.link === link; index++) group += runXml(runs[index]!, index);
    xml += link ? `<w:hyperlink r:id="${links.idFor(link)}" w:history="1">${group}</w:hyperlink>` : group;
  }
  return xml;
}

export const HYPERLINK_RUN_STYLE = '<w:rStyle w:val="Hyperlink"/>';

/** Word's character style for links, so a link Rotli writes looks like one. */
export function withHyperlinkStyle(stylesXml: string): string | null {
  if (/w:styleId=["']Hyperlink["']/i.test(stylesXml) || !/<\/w:styles\s*>/i.test(stylesXml)) return null;
  return stylesXml.replace(
    /<\/w:styles\s*>/i,
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>',
  );
}
