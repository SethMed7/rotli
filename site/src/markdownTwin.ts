// Markdown twins for pages written in Astro rather than Markdown (/privacy/; the owner,
// 2026-10-09: "Full Share like posts"). A post's twin comes straight from its source
// (src/agents.ts writingMarkdown); a page like /privacy/ has no source but its own markup, so its
// twin is made from the built page: the article (`data-prose`) read back into Markdown after the
// build (astro.config.mjs, markdownTwins). Copy Markdown copies it, and a request for the page
// with `Accept: text/markdown` is answered with it (site/Caddyfile), as for a post.
//
// It reads only the markup these pages use: headings, paragraphs, lists, bold, italic, code,
// links, and tables (a header's <small> joins it in parentheses). Decoration (aria-hidden, the
// companions, images, scripts, drawings, buttons) is left out. No DOM and no dependency, so it
// runs in the build and in the tests (scripts/site-markdown-twin.test.ts).

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HtmlNode | string)[];
}

const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SKIP = new Set(['script', 'style', 'svg', 'button', 'img', 'picture', 'template', 'form', 'input', 'label']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A forgiving parse of well-formed HTML (a built page) into a tree. */
export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const token = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    const [whole, close, open, rawAttrs, selfClose, text] = match;
    const top = stack[stack.length - 1];
    if (text !== undefined) top.children.push(decodeEntities(text));
    else if (close) {
      const name = close.toLowerCase();
      const at = stack.map((node) => node.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
    } else if (open) {
      const node: HtmlNode = { tag: open.toLowerCase(), attrs: {}, children: [] };
      for (const [, key, , dq, sq, bare] of (rawAttrs ?? '').matchAll(
        /([^\s=>/]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
      )) {
        node.attrs[key.toLowerCase()] = decodeEntities(dq ?? sq ?? bare ?? '');
      }
      top.children.push(node);
      if (!selfClose && !VOID.has(node.tag)) stack.push(node);
      // Raw text elements: their contents are not markup.
      if (node.tag === 'script' || node.tag === 'style') {
        const end = html.toLowerCase().indexOf(`</${node.tag}`, token.lastIndex);
        token.lastIndex = end < 0 ? html.length : end;
      }
    } else if (whole === '<') top.children.push('<');
  }
  return root;
}

/** The first element (depth first) that `test` accepts. */
export function findElement(node: HtmlNode, test: (node: HtmlNode) => boolean): HtmlNode | undefined {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (test(child)) return child;
    const found = findElement(child, test);
    if (found) return found;
  }
  return undefined;
}

const hasClass = (node: HtmlNode, name: string) => (node.attrs.class ?? '').split(/\s+/).includes(name);
const skipped = (node: HtmlNode) =>
  SKIP.has(node.tag) || node.attrs['aria-hidden'] === 'true' || 'hidden' in node.attrs || hasClass(node, 'spot');

/** The words of an element, as one line of inline Markdown. */
export function inlineMarkdown(node: HtmlNode | string, base: string): string {
  if (typeof node === 'string') return node.replace(/\s+/g, ' ');
  if (skipped(node)) return '';
  const inner = () => node.children.map((child) => inlineMarkdown(child, base)).join('');
  const wrap = (mark: string) => {
    const text = inner();
    const trimmed = text.trim();
    if (!trimmed) return text;
    return `${text.startsWith(' ') ? ' ' : ''}${mark}${trimmed}${mark}${text.endsWith(' ') ? ' ' : ''}`;
  };
  switch (node.tag) {
    case 'strong':
    case 'b':
      return wrap('**');
    case 'em':
    case 'i':
      return wrap('*');
    case 'code':
      return `\`${inner().trim()}\``;
    case 'br':
      return ' ';
    case 'small':
      return ` (${inner().trim()})`;
    case 'a': {
      const text = inner().trim();
      const href = node.attrs.href;
      if (!href) return text;
      return `[${text}](${new URL(href, base).href})`;
    }
    default:
      return inner();
  }
}

const tidy = (line: string) => line.replace(/\s+/g, ' ').trim();

function tableMarkdown(table: HtmlNode, base: string): string[] {
  const rows: string[][] = [];
  const caption = findElement(table, (node) => node.tag === 'caption');
  const collect = (node: HtmlNode) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if (child.tag === 'tr') {
        rows.push(
          child.children
            .filter((cell): cell is HtmlNode => typeof cell !== 'string' && (cell.tag === 'th' || cell.tag === 'td'))
            .map((cell) => tidy(inlineMarkdown(cell, base)).replace(/\|/g, '\\|')),
        );
      } else if (child.tag !== 'caption') collect(child);
    }
  };
  collect(table);
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
  return [
    ...(caption ? [`**${tidy(inlineMarkdown(caption, base))}**`, ''] : []),
    line(rows[0]),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rows.slice(1).map(line),
  ];
}

function listMarkdown(list: HtmlNode, base: string, depth: number): string[] {
  const lines: string[] = [];
  let n = 1;
  for (const item of list.children) {
    if (typeof item === 'string' || item.tag !== 'li' || skipped(item)) continue;
    const marker = list.tag === 'ol' ? `${n++}.` : '-';
    const words = item.children.filter((child) => typeof child === 'string' || !['ul', 'ol'].includes(child.tag));
    const text = tidy(words.map((child) => inlineMarkdown(child, base)).join(''));
    lines.push(`${'  '.repeat(depth)}${marker} ${text}`);
    for (const child of item.children) {
      if (typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol'))
        lines.push(...listMarkdown(child, base, depth + 1));
    }
  }
  return lines;
}

/** Block Markdown for an element's children: one block per heading, paragraph, list, or table. */
export function blockMarkdown(node: HtmlNode, base: string): string[] {
  const blocks: string[][] = [];
  let loose = '';
  const flush = () => {
    if (tidy(loose)) blocks.push([tidy(loose)]);
    loose = '';
  };
  for (const child of node.children) {
    if (typeof child === 'string' || !/^(h[1-6]|p|ul|ol|table|div|section|aside|figure|figcaption|blockquote|header|footer|nav|article|main)$/.test(child.tag)) {
      loose += inlineMarkdown(child, base);
      continue;
    }
    flush();
    if (skipped(child)) continue;
    const heading = /^h([1-6])$/.exec(child.tag);
    if (heading) blocks.push([`${'#'.repeat(Number(heading[1]))} ${tidy(inlineMarkdown(child, base))}`]);
    else if (child.tag === 'p' || child.tag === 'figcaption') {
      const text = tidy(inlineMarkdown(child, base));
      if (text) blocks.push([text]);
    } else if (child.tag === 'ul' || child.tag === 'ol') blocks.push(listMarkdown(child, base, 0));
    else if (child.tag === 'table') blocks.push(tableMarkdown(child, base));
    else if (child.tag === 'blockquote') blocks.push(blockMarkdown(child, base).map((line) => (line ? `> ${line}` : '>')));
    else {
      const inner = blockMarkdown(child, base);
      if (inner.length > 0) blocks.push(inner);
    }
  }
  flush();
  return blocks.filter((block) => block.length > 0).flatMap((block, i) => (i === 0 ? block : ['', ...block]));
}

/** A page's twin: its title, its lede as the summary, the article, and where it lives. */
export function pageMarkdown(html: string, url: string): string {
  const root = parseHtml(html);
  const prose = findElement(root, (node) => 'data-prose' in node.attrs);
  if (!prose) throw new Error(`${url}: no article (data-prose) to make a Markdown twin from`);
  const title = findElement(root, (node) => node.tag === 'h1');
  const lede = findElement(root, (node) => hasClass(node, 'lede'));
  return [
    ...(title ? [`# ${tidy(inlineMarkdown(title, url))}`, ''] : []),
    ...(lede ? [`> ${tidy(inlineMarkdown(lede, url))}`, ''] : []),
    ...blockMarkdown(prose, url),
    '',
    '---',
    '',
    `Source: ${url}`,
    '',
  ].join('\n');
}
