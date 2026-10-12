// The rotli.co addresses an agent file (/llms.txt, /llms-full.txt) sends agents to, as the build
// files that must exist for them (astro.config.mjs, rotli-agent-files-guard). Links come as
// Markdown `(url)` or bare `Page:` lines; trailing sentence punctuation is not part of an address.
// Other origins are not this build's to check, and /app/ is Rotli Web, its own bundle served
// beside this build (site/Caddyfile).
export function agentLinkTargets(text: string, origin: string): { href: string; file: string }[] {
  const targets: { href: string; file: string }[] = [];
  for (const [href] of text.matchAll(/https?:\/\/[^\s)<>\]"'`]+/g)) {
    const url = new URL(href.replace(/[.,;:]+$/, ''));
    if (url.origin !== origin || url.pathname.startsWith('/app/')) continue;
    const path = decodeURIComponent(url.pathname);
    targets.push({ href, file: path.endsWith('/') ? `${path}index.html` : path });
  }
  return targets;
}
