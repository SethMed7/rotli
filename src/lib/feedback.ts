// The "Send feedback" link: a new GitHub issue, prefilled. The repository is
// public and so is every issue, so the body carries ONLY the app version and
// the OS family — never a vault path, a note title, a model, or a token. The
// person writes the rest themselves and sees all of it before it is posted.

export const ROTLI_REPO_URL = "https://github.com/SethMed7/rotli";

export type FeedbackOs = "mac" | "windows" | "linux";

const OS_LABEL: Record<FeedbackOs, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };

/** `version` is null in Rotli Web, which has no bundle. */
export function feedbackUrl(version: string | null, os: FeedbackOs): string {
  const build = version ? `Rotli ${version}` : "Rotli Web";
  const body = `<!-- What happened, or what would you like to see? -->\n\n\n---\n${build} · ${OS_LABEL[os]}\n`;
  return `${ROTLI_REPO_URL}/issues/new?labels=feedback&body=${encodeURIComponent(body)}`;
}
