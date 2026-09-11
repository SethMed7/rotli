import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Conservative publication tripwires. Findings expose locations, never values. */
export function privateFileReason(path) {
  if (/(^|\/)(?:\.rotli|\.breve-secrets|\.carl\/sessions|\.railway)(\/|$)/.test(path))
    return "local application state";
  const name = path.split("/").at(-1);
  if (/^(?:\.env(?:\..*)?|secrets\..*)$/.test(name)) return "environment or secret file";
  if (/\.(?:p12|p8|pem|key|cer|keychain(?:-db)?|mobileprovision|provisionprofile)$/i.test(name))
    return "credential or signing material";
  return null;
}

export function privateTextReasons(text, personalHome) {
  const reasons = [];
  if (/^-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s*$/m.test(text)) reasons.push("private key material");
  if (personalHome && text.includes(`${personalHome}/`)) reasons.push("personal home path");
  return reasons;
}

export function repositoryPrivacyFindings(root, personalHome) {
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const findings = [];
  for (const path of new Set(paths)) {
    let stat;
    try {
      stat = lstatSync(join(root, path));
    } catch {
      continue;
    } // deleted working-tree files
    const reason = privateFileReason(path);
    if (reason) findings.push(`${path}: ${reason}`);
    if (!stat.isFile() || stat.size > 2_000_000) continue;
    const bytes = readFileSync(join(root, path));
    if (bytes.includes(0)) continue;
    for (const why of privateTextReasons(bytes.toString("utf8"), personalHome))
      findings.push(`${path}: ${why}`);
  }
  return findings;
}

/**
 * Inspect the actual bundle, including ignored resources and binary strings.
 * @param {string} root
 * @param {string | null} personalHome
 * @param {{ prefix: string, files: Set<string> } | null} resources
 */
export function bundlePrivacyFindings(root, personalHome, resources = null) {
  const canonical = realpathSync(root);
  const findings = [];
  const homeBytes = personalHome ? Buffer.from(`${personalHome}/`) : null;
  function walk(directory) {
    for (const name of readdirSync(directory)) {
      const file = join(directory, name);
      const path = relative(canonical, file).split(sep).join("/");
      const stat = lstatSync(file);
      if (resources && path.startsWith(resources.prefix)) {
        const declared = stat.isDirectory()
          ? [...resources.files].some((entry) => entry.startsWith(`${path}/`))
          : resources.files.has(path);
        if (!declared) findings.push(`${path}: resource is not in the reviewed source manifest`);
      }
      const reason = privateFileReason(path);
      if (reason) findings.push(`${path}: ${reason}`);
      if (stat.isSymbolicLink()) {
        const link = readlinkSync(file);
        const lexical = resolve(dirname(file), link);
        if (lexical !== canonical && !lexical.startsWith(`${canonical}${sep}`)) {
          findings.push(`${path}: link escapes release bundle`);
          continue;
        }
        if (personalHome && link.includes(`${personalHome}/`))
          findings.push(`${path}: personal home path in artifact`);
        try {
          const target = realpathSync(file);
          if (target !== canonical && !target.startsWith(`${canonical}${sep}`))
            findings.push(`${path}: link escapes release bundle`);
        } catch {
          findings.push(`${path}: unresolved bundle link`);
        }
      } else if (stat.isDirectory()) {
        walk(file);
      } else if (stat.isFile()) {
        const bytes = readFileSync(file);
        if (homeBytes && bytes.includes(homeBytes)) findings.push(`${path}: personal home path in artifact`);
        for (const why of privateTextReasons(bytes.toString("utf8"), null)) findings.push(`${path}: ${why}`);
      }
    }
  }
  walk(canonical);
  return findings;
}
