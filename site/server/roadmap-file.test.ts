// ROADMAP.md as the website reads it (site/src/roadmap.ts): the real file must parse,
// every item must carry a unique id, and the parser must refuse a file that breaks
// the convention, so the site build fails before a vote could attach to the wrong item.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { codeParts, firstSentence, parseRoadmap, PUBLIC_SECTIONS, publicRoadmap, RoadmapError, votableIds } from '../src/roadmap';

const real = readFileSync(new URL('../../ROADMAP.md', import.meta.url), 'utf8');

const file = (items: string) => `# Roadmap

Intro text with an example: \`- **Title** <!-- id: example --> · S — summary\`.

## 1. In the work

${items}

## 2. Planned

- **Planned thing** <!-- id: planned-thing --> · L — it is planned.

## 3. Ideas

- **An idea** <!-- id: an-idea --> — no size. Still an idea.
`;

describe('the real ROADMAP.md', () => {
  test('has the three public sections, each with items', () => {
    const sections = publicRoadmap(real);
    expect(sections.map((section) => section.title)).toEqual([...PUBLIC_SECTIONS]);
    for (const section of sections) expect(section.items.length).toBeGreaterThan(0);
  });

  test('every item in every section has a well-formed id, used once', () => {
    const items = parseRoadmap(real).flatMap((section) => section.items);
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    // Every top-level list item in a numbered section became an item (the parser throws
    // on one without an id), so none was skipped.
    const body = real.slice(real.indexOf('\n## 1.'));
    const bullets = body.split('\n').filter((line) => line.startsWith('- '));
    expect(bullets.length).toBe(items.length);
    expect(body.match(/<!-- id: [a-z0-9-]+ -->/g)?.length).toBe(items.length);
  });

  test('summaries are one readable sentence', () => {
    for (const section of publicRoadmap(real)) {
      for (const item of section.items) {
        expect(item.summary).toMatch(/^[A-Z"`]/);
        expect(item.summary).toMatch(/[.!?]$/);
        expect(item.summary).not.toContain('](');
        expect(item.summary).not.toContain('<!--');
      }
    }
  });

  test('only the public sections are votable', () => {
    const ids = votableIds(real);
    expect(ids).toContain('sheets-beta');
    expect(ids).toContain('version-history');
    expect(ids).not.toContain('windows'); // Platforms stays in the file
    expect(ids).not.toContain('bug-first-drop');
  });
});

describe('the parser', () => {
  test('reads title, id, size, and the first sentence', () => {
    const [work, planned, ideas] = publicRoadmap(
      file(`- **Charts (\`/chart\`)** <!-- id: charts --> · M–L — type \`/chart\` and see
  a chart ([evaluation](docs/x.md)). The library is open. More [here](docs/y.md).
  - a sub-point that is not the summary`),
    );
    expect(work.items).toEqual([
      { id: 'charts', title: 'Charts (`/chart`)', size: 'M–L', summary: 'Type `/chart` and see a chart.' },
    ]);
    expect(planned.items[0]).toMatchObject({ id: 'planned-thing', size: 'L', summary: 'It is planned.' });
    expect(ideas.items[0]).toMatchObject({ id: 'an-idea', size: null, summary: 'No size.' });
    expect(work.slug).toBe('in-the-work');
  });

  test('a title that wraps onto the next line is still one title', () => {
    const [work] = publicRoadmap(file(`- **A long title that
  wraps** <!-- id: long-title --> · S — fine.`));
    expect(work.items[0]).toMatchObject({ id: 'long-title', title: 'A long title that wraps' });
  });

  test('a fenced block inside an item is not read as items', () => {
    const [work] = publicRoadmap(
      file(`- **Fence** <!-- id: fence --> · S — has code.

  \`\`\`
  - **Not an item** · S — inside a fence
  \`\`\`

- **After** <!-- id: after --> · S — after the fence.`),
    );
    expect(work.items.map((item) => item.id)).toEqual(['fence', 'after']);
  });

  test('refuses an item without an id', () => {
    expect(() => parseRoadmap(file('- **No id** · S — nothing to vote on.'))).toThrow(RoadmapError);
    expect(() => parseRoadmap(file('- **No id** · S — nothing to vote on.'))).toThrow(/has no id/);
  });

  test('refuses a repeated id, naming both items', () => {
    expect(() =>
      parseRoadmap(file('- **One** <!-- id: same --> · S — one.\n- **Two** <!-- id: same --> · S — two.')),
    ).toThrow(/"same" is used twice \("One" and "Two"\)/);
    // Across sections too.
    expect(() => parseRoadmap(file('- **Dup** <!-- id: an-idea --> · S — clash.'))).toThrow(/used twice/);
  });

  test('refuses a malformed id or an item that does not follow the convention', () => {
    expect(() => parseRoadmap(file('- **Caps** <!-- id: Bad_Id --> · S — no.'))).toThrow(/lowercase words/);
    expect(() => parseRoadmap(file('- plain text item without a title'))).toThrow(/does not read/);
  });

  test('refuses a file that lost a public section', () => {
    expect(() => publicRoadmap('## 1. In the work\n\n- **A** <!-- id: a --> · S — a.\n')).toThrow(/Planned/);
  });

  test('firstSentence keeps file extensions and capitalizes', () => {
    expect(firstSentence('saved as real .xlsx. Needs more.')).toBe('Saved as real .xlsx.');
    expect(firstSentence('`/chart` first. Then more.')).toBe('`/chart` first.');
  });

  test('codeParts splits on backticks', () => {
    expect(codeParts('Type `/ai` here')).toEqual([
      { code: false, text: 'Type ' },
      { code: true, text: '/ai' },
      { code: false, text: ' here' },
    ]);
  });
});
