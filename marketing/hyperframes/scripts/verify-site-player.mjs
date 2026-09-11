// Proves the website player works with the delivered artifacts against a local
// static preview: a fresh browser context (no profile), only the preview origin
// reachable, the poster and MP4 served, the caption track loaded with cues,
// playback started from the real "Watch the film" control, and a screenshot of
// the section for human review. Usage:
//   bun scripts/verify-site-player.mjs http://127.0.0.1:4321 /tmp/site-player.png
import { chromium } from '@playwright/test';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4321');
const shot = process.argv[3] ?? '/tmp/rotli-site-player.png';
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Local preview only');

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto(origin.origin, { waitUntil: 'networkidle' });
  const video = page.locator('#film-player');
  if ((await video.count()) !== 1) throw new Error('film player not rendered (site.promo.enabled false?)');
  const facts = await video.evaluate((v) => ({
    poster: v.getAttribute('poster'),
    src: v.querySelector('source')?.getAttribute('src'),
    track: v.querySelector('track')?.getAttribute('src'),
    width: v.getAttribute('width'),
    height: v.getAttribute('height'),
  }));
  for (const [name, path] of Object.entries(facts)) {
    if (!path) throw new Error(`missing ${name}`);
    if (['poster', 'src', 'track'].includes(name)) {
      const res = await page.request.get(new URL(path, origin.origin).href);
      const type = res.headers()['content-type'] ?? '';
      const len = res.headers()['content-length'] ?? '?';
      console.log(`${name.padEnd(6)} ${path}  ${res.status()} ${type} ${len} bytes`);
      if (!res.ok()) throw new Error(`${name} not served`);
    }
  }
  await page.locator('#film').scrollIntoViewIfNeeded();
  const play = page.getByRole('button', { name: 'Play the Rotli film' });
  await play.waitFor({ state: 'visible' });
  await play.click();
  await page.waitForFunction(() => {
    const v = document.querySelector('#film-player');
    return v && !v.paused && v.currentTime > 0.5;
  }, null, { timeout: 15000 });
  const playback = await video.evaluate((v) => {
    const track = v.textTracks[0];
    if (track) track.mode = 'showing';
    return { duration: v.duration, currentTime: v.currentTime, videoWidth: v.videoWidth, videoHeight: v.videoHeight, tracks: v.textTracks.length, mode: track?.mode };
  });
  await page.waitForFunction(() => document.querySelector('#film-player')?.textTracks[0]?.cues?.length > 0, null, { timeout: 15000 });
  const cues = await video.evaluate((v) => Array.from(v.textTracks[0].cues).map((c) => `${c.startTime.toFixed(1)}–${c.endTime.toFixed(1)} ${c.text}`));
  console.log(`playback: ${playback.videoWidth}×${playback.videoHeight}, duration ${playback.duration.toFixed(2)}s, playing at ${playback.currentTime.toFixed(2)}s, ${playback.tracks} text track (${playback.mode}), ${cues.length} cues`);
  for (const c of cues) console.log(`  ${c}`);
  if (Math.abs(playback.duration - 41.8) > 0.25) throw new Error(`unexpected duration ${playback.duration}`);
  if (cues.length !== 13) throw new Error(`expected 13 cues, got ${cues.length}`);
  const errorVisible = await page.locator('.film-error').isVisible();
  if (errorVisible) throw new Error('playback error state shown');
  await video.evaluate((v) => { v.currentTime = 16; });
  await page.waitForTimeout(600);
  await page.locator('#film').screenshot({ path: shot });
  console.log(`screenshot -> ${shot}`);
  await context.close();
} finally {
  await browser.close();
}
