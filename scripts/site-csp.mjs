function directiveSources(caddyfile, directive) {
  const header = caddyfile.match(/Content-Security-Policy\s+"([^"]+)"/);
  if (!header) return [];
  const entry = header[1]
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === directive || part.startsWith(`${directive} `));
  return entry ? entry.split(/\s+/).slice(1) : [];
}

function remoteImageOrigins(contents) {
  const origins = new Set();
  const image = /<img\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi;
  for (const match of contents.matchAll(image)) origins.add(new URL(match[2]).origin);
  return origins;
}

export function siteRemoteImageCspFindings(caddyfile, sources) {
  const allowed = new Set(directiveSources(caddyfile, "img-src"));
  const findings = [];
  for (const { path, contents } of sources) {
    for (const origin of remoteImageOrigins(contents)) {
      if (!allowed.has(origin)) {
        findings.push(
          `${path}: remote <img> origin ${JSON.stringify(origin)} is not allowed by site/Caddyfile img-src.`,
        );
      }
    }
  }
  return findings;
}
