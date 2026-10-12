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
  return normalized;
}
