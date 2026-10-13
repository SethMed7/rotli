const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const STRICT_WORD_NAMESPACE = "http://purl.oclc.org/ooxml/wordprocessingml/main";
// Fixed patterns only: nothing read from a document becomes a regular expression.
const WORD_PREFIX_DECLARATION =
  /xmlns:([A-Za-z_][\w.-]*)=["'](?:http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/wordprocessingml\/main)["']/g;
const TRANSITIONAL_PREFIX_DECLARATION =
  /xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main["']/g;
const TRANSITIONAL_DEFAULT_DECLARATION =
  /xmlns=["']http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main["']/;
const PREFIXED_ATTRIBUTE = /(\s)([A-Za-z_][\w.-]*):([\w.-]+)=/g;

/** The editor's parser uses w: spellings. Keep OOXML's local names while
 * mapping any WordprocessingML prefix and Strict URI to that spelling. */
export function editorWordXml(xml: string): string {
  const prefixes = new Set(
    Array.from(xml.matchAll(WORD_PREFIX_DECLARATION), (match) => match[1]).filter(
      (prefix): prefix is string => !!prefix && prefix !== "w",
    ),
  );
  let normalized = xml.replaceAll(STRICT_WORD_NAMESPACE, WORD_NAMESPACE);
  if (prefixes.size > 0) {
    for (const prefix of prefixes) {
      normalized = normalized.replaceAll(`<${prefix}:`, "<w:").replaceAll(`</${prefix}:`, "</w:");
    }
    normalized = normalized.replace(
      PREFIXED_ATTRIBUTE,
      (whole, space: string, prefix: string, name: string) =>
        prefixes.has(prefix) ? `${space}w:${name}=` : whole,
    );
    // each prefix's first declaration becomes w:'s, as the per-prefix replace did
    const declared = new Set<string>();
    normalized = normalized.replace(TRANSITIONAL_PREFIX_DECLARATION, (whole, prefix: string) => {
      if (!prefixes.has(prefix) || declared.has(prefix)) return whole;
      declared.add(prefix);
      return `xmlns:w="${WORD_NAMESPACE}"`;
    });
  }
  if (TRANSITIONAL_DEFAULT_DECLARATION.test(normalized)) {
    const wordDefaults: boolean[] = [];
    normalized = normalized.replace(
      /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(\/?)((?:[A-Za-z_][\w.:-]*))([^>]*)>/g,
      (whole, closing: string | undefined, name: string | undefined, rest: string | undefined) => {
        if (!name || rest === undefined) return whole;
        if (closing) {
          const word = wordDefaults.pop() ?? false;
          return word && !name.includes(":") ? `</w:${name}${rest}>` : whole;
        }
        const inherited = wordDefaults.at(-1) ?? false;
        const declaration = /\sxmlns=["']([^"']+)["']/.exec(rest)?.[1];
        const word = declaration === undefined ? inherited : declaration === WORD_NAMESPACE;
        if (!/\/\s*$/.test(rest)) wordDefaults.push(word);
        if (!word || name.includes(":")) return whole;
        const attributes = declaration
          ? rest.replace(/\sxmlns=["'][^"']+["']/, ` xmlns:w="${WORD_NAMESPACE}"`)
          : rest;
        return `<w:${name}${attributes}>`;
      },
    );
  }
  return normalized;
}
