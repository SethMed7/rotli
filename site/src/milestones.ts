// The About page's timeline: a few real releases, each with a short line in plain words.
// Only the words are written here. Every date is read from CHANGELOG.md at build time (the
// changelog collection's body), and a version missing from it fails the build, so the page
// can never show a release or a date that didn't happen. Keep the lines to what that
// release's changelog entry says.

export type Milestone = { version: string; title: string; line: string };
export type DatedMilestone = Milestone & { date: string; label: string; short: string };

export const MILESTONES: readonly Milestone[] = [
  {
    version: '1.0.0',
    title: 'rotli 1.0',
    line: 'Notes, tasks, and links on the Mac, every one a plain file in your folder.',
  },
  {
    version: '1.1.0',
    title: 'Rotli Web',
    line: 'The same workspace in your browser, working in a folder on your computer.',
  },
  {
    version: '1.3.0',
    title: 'Chat gets its own window',
    line: 'Plus templates, and slash commands inside a list.',
  },
  {
    version: '1.4.0',
    title: 'Boards on the web',
    line: 'Excalidraw boards save as real files from the browser too.',
  },
  {
    version: '1.5.0',
    title: 'Blossom',
    line: 'A seventh theme family: light pink by day, a deep plum-rose at night.',
  },
  {
    version: '1.6.0',
    title: 'The Librarian, in the corner',
    line: 'Ask it from a note, give it your own rules, and hide the parts you don’t use.',
  },
  {
    version: '1.7.0',
    title: 'Setup comes alive',
    line: 'The island rises out of the sea, the lighthouse turns, and your quokka hops onto the sand.',
  },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Every `## [x.y.z] - YYYY-MM-DD` heading in the changelog, by version. */
export function releaseDates(changelog: string): Map<string, string> {
  const dates = new Map<string, string>();
  for (const match of changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm)) {
    dates.set(match[1], match[2]);
  }
  return dates;
}

/** "2026-09-15" → "September 15, 2026", without the build machine's locale. */
export function dateLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** The milestones with their real dates. Throws if the changelog lacks one of them. */
export function datedMilestones(changelog: string): DatedMilestone[] {
  const dates = releaseDates(changelog);
  return MILESTONES.map((milestone) => {
    const date = dates.get(milestone.version);
    if (!date) throw new Error(`About timeline: ${milestone.version} has no dated heading in CHANGELOG.md`);
    return { ...milestone, date, label: dateLabel(date), short: milestone.version.replace(/\.0$/, '') };
  });
}
