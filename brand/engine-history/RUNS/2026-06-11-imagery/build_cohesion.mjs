#!/usr/bin/env node
// build_cohesion.mjs — rotli cohesion gate (imagery + patterns + textures + motion + LIVE kit SVGs).
// Kit SVGs are INLINED at build time (camino lesson: fetch() of kit files is blocked on file://).
// Rebuild after any asset change: node build_cohesion.mjs && open cohesion.html
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '../../../../kits/rotli');

const inline = (p, attrs = '') => readFileSync(join(KIT, p), 'utf8').replace('<svg ', `<svg ${attrs} `).trim();
const wordmark = inline('logo/wordmark.svg', 'class="wm"');
const wordmarkWhite = inline('logo/wordmark.mono-white.svg', 'class="wm"');
const rMark = inline('logo/r-mark.svg', 'class="rm"');
const rMarkWhite = inline('logo/r-mark.mono-white.svg', 'class="rm"');
const curl = readFileSync(join(HERE, 'pattern/curl-flourish.svg'), 'utf8').trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>rotli — cohesion gate (imagery · pattern · texture · motion)</title>
<style>
  @font-face{font-family:"Satoshi";src:url("../../../../kits/rotli/fonts/Satoshi-Variable.woff2") format("woff2");font-weight:300 900;font-display:swap}
  @font-face{font-family:"General Sans";src:url("../../../../kits/rotli/fonts/GeneralSans-Variable.woff2") format("woff2");font-weight:300 700;font-display:swap}
  :root{--cocoa:#3A3028;--clay:#C97E62;--clay-text:#8F4E37;--peach:#F2D6C2;--linen:#F8F2E9;--olive:#8D9A76;--dark:#241D18;
        --display:"Satoshi",system-ui,sans-serif;--body:"General Sans",system-ui,sans-serif}
  *{box-sizing:border-box;margin:0}
  body{background:var(--linen);color:var(--cocoa);font-family:var(--body);line-height:1.55}
  section{position:relative;overflow:hidden}
  .inner{max-width:1040px;margin:0 auto;padding:96px 40px;position:relative;z-index:2}
  h1,h2{font-family:var(--display);font-weight:700;letter-spacing:-.015em}
  .eyebrow{font-family:var(--display);font-weight:600;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--clay-text)}
  .gate-tag{position:absolute;top:14px;right:16px;z-index:9;font-size:11px;letter-spacing:.1em;text-transform:uppercase;background:rgba(58,48,40,.78);color:#F1E7DA;padding:5px 10px;border-radius:99px}
  .bgimg{position:absolute;inset:0;background-size:cover;background-position:center;z-index:0}
  .wm{height:54px;width:auto;display:block}
  .rm{height:44px;width:auto}
  img.illus{display:block;max-width:100%;border-radius:18px}
  ${readFileSync(join(HERE, 'css/textures.css'), 'utf8')}
  ${readFileSync(join(HERE, 'css/motion.css'), 'utf8')}
  /* page-specific */
  .hero{min-height:78vh;display:flex;align-items:flex-end}
  .hero .scrim{position:absolute;inset:0;z-index:1}
  .hero h1{font-size:clamp(38px,6vw,64px);line-height:1.06;max-width:13ch}
  .hero p{margin-top:18px;max-width:46ch;color:#6E6155}
  .btn{display:inline-block;margin-top:28px;background:var(--clay);color:#fff;font-family:var(--display);font-weight:600;padding:13px 26px;border-radius:999px;text-decoration:none}
  .btn.ghost{background:transparent;border:1.5px solid var(--clay);color:var(--clay-text);margin-left:12px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
  @media(max-width:860px){.grid2{grid-template-columns:1fr}}
  .divider{display:flex;justify-content:center;gap:0;color:var(--clay);opacity:.55;padding:8px 0}
  .divider svg{width:56px;height:56px}
  .dark-sec{color:#F1E7DA}
  .dark-sec .eyebrow{color:var(--clay)}
  .dark-sec p{color:#B7A593}
  .card-row{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:36px}
  @media(max-width:860px){.card-row{grid-template-columns:1fr}}
  .card{background:#fff;border:1px solid #E7DBC9;border-radius:14px;padding:22px}
  .card h3{font-family:var(--display);font-size:16px;display:flex;align-items:center;gap:10px}
  .card p{font-size:13.5px;color:#6E6155;margin-top:8px}
  .dotfield{position:absolute;inset:0;color:var(--cocoa);z-index:0}
  footer{background:var(--dark);color:#B7A593;font-size:13px}
  footer .inner{padding:64px 40px;display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap}
</style>
</head>
<body>

<!-- 1 · LIGHT HERO — island-wide + scrim + live wordmark -->
<section class="hero ro-grain">
  <span class="gate-tag">1 · island-wide.png</span>
  <div class="bgimg" style="background-image:url('island-wide.png')"></div>
  <div class="scrim ro-scrim-light"></div>
  <div class="inner">
    <div class="ro-wordmark-reveal" style="margin-bottom:34px">${wordmark}</div>
    <h1 class="ro-settle is-in">Quietly holds what matters.</h1>
    <p class="ro-settle is-in">Notes, voice, calendars and tasks in one warm menu-bar shell — there when you summon it, gone when you don't.</p>
    <a class="btn ro-hover" href="#">Get rotli</a><a class="btn ghost ro-hover" href="#">See how it works</a>
  </div>
</section>

<div class="divider">${curl}</div>

<!-- 2 · CHARACTER — the quokka -->
<section class="ro-linen-field ro-grain">
  <span class="gate-tag">2 · quokka-master + poses</span>
  <div class="inner">
    <div class="grid2">
      <div>
        <span class="eyebrow">The quokka principle</span>
        <h2 style="font-size:34px;margin-top:10px">Always smiling, because the island was built for it.</h2>
        <p style="margin-top:14px;color:#6E6155">The app is the island. Every module belongs to it; nothing has to be learned. The quokka shows up in empty states, onboarding and small celebrations — never in the way.</p>
      </div>
      <img class="illus ro-hover" src="quokka-master.png" alt="the rotli quokka" style="max-width:380px;justify-self:center"/>
    </div>
    <img class="illus" src="quokka-poses.png" alt="quokka poses" style="margin-top:44px"/>
  </div>
</section>

<!-- 3 · DARK HERO — lamp-nook + knockout marks -->
<section class="dark-sec ro-grain ro-dark-field">
  <span class="gate-tag">3 · lamp-nook.png</span>
  <div class="bgimg" style="background-image:url('lamp-nook.png');opacity:.85"></div>
  <div class="scrim ro-scrim-dark" style="position:absolute;inset:0;z-index:1"></div>
  <div class="inner" style="z-index:2">
    <div style="margin-bottom:30px">${wordmarkWhite}</div>
    <span class="eyebrow">Dark mode</span>
    <h2 style="font-size:34px;margin-top:10px;max-width:18ch">Paper under a desk lamp, not a monitor.</h2>
    <p style="margin-top:14px;max-width:44ch">Deep warm cocoa, one pool of light. The same five tones, after dark.</p>
  </div>
</section>

<!-- 4 · JOURNEY — island-path + cards -->
<section class="ro-grain" style="background:var(--linen)">
  <span class="gate-tag">4 · island-path.png</span>
  <div class="inner">
    <div class="grid2">
      <img class="illus" src="island-path.png" alt="path to the glow"/>
      <div>
        <span class="eyebrow">Onboarding</span>
        <h2 style="font-size:34px;margin-top:10px">A short path, a warm light.</h2>
        <p style="margin-top:14px;color:#6E6155">Three steps and you're home: pick your hotkey, pick your modules, start typing. No accounts to climb over.</p>
      </div>
    </div>
    <div class="card-row">
      <div class="card ro-visit"><h3><span style="color:var(--clay)">●</span> Quick Notes</h3><p>Capture thoughts in a flash — the window visits, it doesn't move in.</p></div>
      <div class="card ro-visit" style="animation-delay:80ms"><h3><span style="color:var(--olive)">●</span> Sync</h3><p>All caught up. A balanced loop for seamless updates.</p></div>
      <div class="card ro-visit" style="animation-delay:160ms"><h3><span style="color:var(--clay)">●</span> Transcript</h3><p>Speech becomes clear, calm text. Locally.</p></div>
    </div>
  </div>
</section>

<!-- 5 · CODE-ONLY — no imagery; fields + grain + dots + curl + live marks must carry the brand -->
<section class="ro-peach-field ro-grain">
  <span class="gate-tag">5 · code-only (no imagery)</span>
  <div class="dotfield ro-dots"></div>
  <div class="inner" style="text-align:center">
    <div style="display:flex;justify-content:center;margin-bottom:26px">${rMark}</div>
    <span class="eyebrow">No photograph needed</span>
    <h2 style="font-size:34px;margin-top:10px">The brand reads in pure code.</h2>
    <p style="margin-top:14px;color:#6E6155;max-width:52ch;margin-left:auto;margin-right:auto">Gradient field, paper grain, the dot tile and the curl — tokens and patterns alone, holding the same warm room.</p>
    <div class="divider" style="margin-top:18px">${curl}${curl}${curl}</div>
  </div>
</section>

<!-- 6 · DETAILS — botanical spots + grounds -->
<section style="background:#fff">
  <span class="gate-tag">6 · botanical-spots + grounds</span>
  <div class="inner">
    <span class="eyebrow">Details</span>
    <h2 style="font-size:34px;margin-top:10px">Small things from the island.</h2>
    <p style="margin-top:14px;color:#6E6155;max-width:52ch">Spot illustrations for empty states and moments; near-flat paper grounds for light and dark surfaces.</p>
    <img class="illus" src="botanical-spots.png" alt="spot illustrations" style="margin-top:30px"/>
    <div class="card-row" style="grid-template-columns:1fr 1fr">
      <div><img class="illus" src="paper-linen.png" alt="linen ground"/><p style="font-size:12px;color:#6E6155;margin-top:8px">paper-linen — light ground</p></div>
      <div><img class="illus" src="cocoa-night.png" alt="cocoa ground"/><p style="font-size:12px;color:#6E6155;margin-top:8px">cocoa-night — dark ground</p></div>
    </div>
  </div>
</section>

<footer class="ro-grain ro-dark-field">
  <div class="inner">
    <div style="display:flex;align-items:center;gap:16px">${rMarkWhite}<span style="font-family:var(--display);font-weight:600;color:#F1E7DA">rotli — warm · quiet · instant</span></div>
    <span>cohesion gate · ${new Date().toISOString().slice(0, 10)} · judge: does it all read as ONE brand? per-asset keep/kill.</span>
  </div>
</footer>

</body>
</html>
`;

writeFileSync(join(HERE, 'cohesion.html'), html);
console.log('cohesion.html built (kit SVGs inlined)');
