const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const STRICT_WORD_NAMESPACE = "http://purl.oclc.org/ooxml/wordprocessingml/main";

/** The editor's parser uses w: spellings. Keep OOXML's local names while
 * mapping any WordprocessingML prefix and Strict URI to that spelling. */
export function editorWordXml(xml: string): string {
  const prefixes = Array.from(
    xml.matchAll(
      /xmlns:([A-Za-z_][\w.-]*)=["'](?:http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/wordprocessingml\/main)["']/g,
    ),
    (match) => match[1],
  );
  let normalized = xml.replaceAll(STRICT_WORD_NAMESPACE, WORD_NAMESPACE);
  for (const prefix of prefixes) {
    if (!prefix || prefix === "w") continue;
    normalized = normalized.replaceAll(`<${prefix}:`, "<w:").replaceAll(`</${prefix}:`, "</w:");
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(new RegExp(`(\\s)${escaped}:([\\w.-]+)=`, "g"), "$1w:$2=");
    normalized = normalized.replace(
      new RegExp(`xmlns:${escaped}=["']${WORD_NAMESPACE}["']`),
      `xmlns:w="${WORD_NAMESPACE}"`,
    );
  }
  if (new RegExp(`xmlns=["']${WORD_NAMESPACE}["']`).test(normalized)) {
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
