/** Stable identities for doctor findings, used to notify on state changes only. */

function normalizeFinding(finding: string): string {
  return finding
    .trim()
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n");
}

function fingerprint(value: string): string {
  // FNV-1a is deterministic across Bun versions and sufficient for local state.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function findingFingerprints(findings: string[]): string[] {
  return [...new Set(findings.map((finding) => fingerprint(normalizeFinding(finding))))].sort();
}

export function newFindings(findings: string[], activeFingerprints: string[]): string[] {
  const active = new Set(activeFingerprints);
  return findings.filter((finding) => !active.has(fingerprint(normalizeFinding(finding))));
}
