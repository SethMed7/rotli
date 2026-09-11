import type { CSSProperties } from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import palette from '../../src/brand/tokens/colors.json';

const c = palette.surfaces.light;
const ease = (f: number, start: number, end: number) => interpolate(f, [start, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

export function LaunchFilm() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const chapter = frame < 120 ? 0 : frame < 390 ? 1 : 2;
  const starts = [0, 120, 390];
  const ends = [120, 390, 540];
  const progress = ease(frame, starts[chapter]!, starts[chapter]! + 18);
  const fade = 1 - ease(frame, ends[chapter]! - 12, ends[chapter]!);
  const title: CSSProperties = { fontSize: portrait ? 104 : 108, lineHeight: 1.04, letterSpacing: '-0.045em', fontWeight: 600, margin: 0 };
  const eyebrow: CSSProperties = { fontSize: 26, fontWeight: 550, color: c['accent-text'], marginBottom: 28 };
  return <AbsoluteFill style={{ background: c.ground, color: c.text, fontFamily: 'General Sans, sans-serif' }}>
    <style>{`@font-face { font-family: 'General Sans'; src: url('${staticFile('GeneralSans.woff2')}') format('woff2'); font-weight: 200 700; }`}</style>
    <div style={{ position: 'absolute', top: portrait ? 96 : 62, left: 80, right: 80, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.05em' }}>rotli</span>
      <span style={{ fontSize: 22, color: c['text-muted'] }}>A workspace for your Mac</span>
    </div>
    <div style={{ position: 'absolute', inset: 0, opacity: progress * fade, transform: `translateY(${(1 - progress) * 24}px)` }}>
      {chapter === 0 && <>
        <div style={{ position: 'absolute', left: 80, top: portrait ? 330 : 310, width: portrait ? 900 : 1100 }}>
          <div style={eyebrow}>LOCAL FILES. A LITTLE MORE POSSIBILITY.</div>
          <h1 style={{ ...title, fontSize: portrait ? 136 : 152 }}>Room to think.<br />Files you keep.</h1>
          <p style={{ fontSize: 34, lineHeight: 1.45, maxWidth: 740, color: c['text-muted'], marginTop: 42 }}>Notes, plans, and ideas.<br />One ordinary folder you own.</p>
        </div>
        <Img src={staticFile('quokka.webp')} style={{ position: 'absolute', width: portrait ? 650 : 580, height: portrait ? 650 : 580, objectFit: 'contain', left: portrait ? 320 : 1260, top: portrait ? 1050 : 310, transform: `rotate(${interpolate(frame, [0, 120], [-3, 2])}deg)` }} />
      </>}
      {chapter === 1 && <>
        <div style={{ position: 'absolute', left: 80, top: portrait ? 285 : 184 }}>
          <div style={eyebrow}>MEET THE PLAYGROUND</div>
          <h1 style={{ ...title, fontSize: portrait ? 110 : 76 }}>Try it. Change it.<br />Keep what helps.</h1>
          <p style={{ fontSize: 29, color: c['text-muted'], marginTop: 28, maxWidth: portrait ? 900 : 610 }}>Ten guided lessons. Save only what you choose.</p>
        </div>
        <div style={{ position: 'absolute', left: portrait ? 70 : 790, top: portrait ? 735 : 230, width: portrait ? 940 : 1050, height: portrait ? 890 : 660, border: `2px solid ${c.border}`, borderRadius: 16, overflow: 'hidden', background: c.surface, transform: `scale(${1 + ease(frame, 120, 390) * 0.018})` }}>
          <Img src={staticFile('playground.png')} style={portrait ? { width: 1440, height: 900, maxWidth: 'none', transform: 'translateX(-240px)' } : { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top left' }} />
        </div>
        <p style={{ position: 'absolute', left: portrait ? 80 : 790, top: portrait ? 1650 : 912, fontSize: 21, color: c['text-muted'] }}>Actual browser preview · practice stays out of Main until saved</p>
      </>}
      {chapter === 2 && <div style={{ position: 'absolute', left: 80, right: 80, top: portrait ? 420 : 290 }}>
        <div style={eyebrow}>START WITH ONE USEFUL THOUGHT</div>
        <h1 style={{ ...title, fontSize: portrait ? 124 : 140 }}>Make room<br />for your own work.</h1>
        <div style={{ marginTop: 64, display: 'inline-block', padding: '20px 40px', background: c.text, color: c.ground, borderRadius: 12, fontSize: 48, fontWeight: 550 }}>rotli.co</div>
        <p style={{ fontSize: 28, color: c['text-muted'], marginTop: 32 }}>Mac beta in preparation<br />Local-first · no account required</p>
      </div>}
    </div>
    <div style={{ position: 'absolute', bottom: 0, height: 5, width: `${frame / 539 * 100}%`, background: c.accent }} />
  </AbsoluteFill>;
}
