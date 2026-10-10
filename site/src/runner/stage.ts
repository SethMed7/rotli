// Draws the 404 game (./game.ts) on its canvas and turns keys, clicks, and taps into jumps
// and ducks.
//
// It never starts by itself: the Play button starts a run, and focus moves to the stage so
// Space, ↑, or W jump, ↓ or S duck while held (and Escape or P pause); a tap or click on the
// stage jumps, and a press on the sand (the stage's lower third) or a swipe down ducks while
// the finger stays down. Keys are read only while the stage has focus, so Space or ↓ on
// "Take me home" or anywhere else on the page is never taken. The level shows beside the
// score and lights up briefly when it goes up. A run pauses itself when the tab is hidden or the stage scrolls out of view,
// and the frame loop runs only while a run is on; at rest the canvas holds one still frame.
// Under reduced motion the game still plays (it is the visitor's choice to start it), but
// the decorative layers (drifting clouds, the run's bob, kicked-up sand) stand still.
// Colours come from the page's tokens; drawing is canvas only, so the Content-Security-
// Policy has nothing to object to. No score is stored: the best run lasts as long as the page.
import { WORLD, createGame, duck, jump, level, metres, pause, release, resume, start, step, type Game, type Obstacle } from './game';

interface Palette {
  ink: string;
  sea: string;
  seaDeep: string;
  seaLine: string;
  sand: string;
  limestone: string;
  olive: string;
  oliveBright: string;
  wood: string;
  woodDark: string;
  cocoa: string;
  accent: string;
  cloud: string;
  sky: string;
}

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    ink: v('--ink'),
    sea: v('--sea'),
    seaDeep: v('--sea-deep'),
    seaLine: v('--sea-line'),
    sand: v('--sand'),
    limestone: v('--limestone'),
    olive: v('--olive'),
    oliveBright: v('--olive-bright'),
    wood: v('--wood'),
    woodDark: v('--wood-dark'),
    cocoa: v('--cocoa'),
    accent: v('--accent'),
    cloud: v('--surface-2'),
    sky: v('--ground'),
  };
}

/** The walking pose's two masks, filled with the body colour and the ink, as one picture. */
async function sprite(bodyUrl: string, lineUrl: string, colours: Palette): Promise<HTMLCanvasElement | null> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  try {
    const [body, line] = await Promise.all([load(bodyUrl), load(lineUrl)]);
    const tint = (image: HTMLImageElement, colour: string) => {
      const layer = document.createElement('canvas');
      layer.width = image.naturalWidth;
      layer.height = image.naturalHeight;
      const g = layer.getContext('2d')!;
      g.drawImage(image, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = colour;
      g.fillRect(0, 0, layer.width, layer.height);
      return layer;
    };
    const out = document.createElement('canvas');
    out.width = body.naturalWidth;
    out.height = body.naturalHeight;
    const g = out.getContext('2d')!;
    g.drawImage(tint(body, colours.cocoa), 0, 0);
    g.drawImage(tint(line, colours.ink), 0, 0);
    return out;
  } catch {
    return null;
  }
}

export function mountRunner(stage: HTMLElement) {
  const canvas = stage.querySelector<HTMLCanvasElement>('canvas');
  const overlay = stage.querySelector<HTMLElement>('[data-overlay]');
  const title = stage.querySelector<HTMLElement>('[data-overlay-title]');
  const note = stage.querySelector<HTMLElement>('[data-overlay-note]');
  const play = stage.querySelector<HTMLButtonElement>('[data-play]');
  const scoreEl = stage.querySelector<HTMLElement>('[data-score]');
  const bestEl = stage.querySelector<HTMLElement>('[data-best]');
  const levelEl = stage.querySelector<HTMLElement>('[data-level]');
  const announce = stage.querySelector<HTMLElement>('[data-announce]');
  if (!canvas || !overlay || !title || !note || !play || !scoreEl || !bestEl) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const ctx: CanvasRenderingContext2D = context;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let colours = palette();
  let runnerArt: HTMLCanvasElement | null = null;
  void sprite(stage.dataset.body ?? '', stage.dataset.line ?? '', colours).then((art) => {
    runnerArt = art;
    draw(performance.now());
  });

  let scale = 1;
  let game: Game = createGame(600);
  let raf = 0;
  let last = 0;
  let shownScore = -1;
  let shownLevel = 1;
  let levelUpTimer = 0;
  let onScreen = true;
  /** The finger or mouse button that is holding a duck, if any. */
  let duckPointer: number | null = null;
  let press: { id: number; y: number } | null = null;

  function resize() {
    const box = canvas!.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas!.width = Math.round(box.width * ratio);
    canvas!.height = Math.round(box.height * ratio);
    scale = (box.height * ratio) / WORLD.height;
    game = { ...game, width: canvas!.width / scale };
    draw(performance.now());
  }

  // ——— Drawing ———

  // The sand line, in world units from the top; the sea and the dunes sit just above it, and
  // the rest of the stage is sky (room for a jump and for what flies over).
  const groundY = () => WORLD.height - 48;

  function outline(width = 3) {
    ctx.lineWidth = width;
    ctx.strokeStyle = colours.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function backdrop(now: number) {
    const w = game.width;
    const drift = reduced.matches ? 0 : game.distance;
    ctx.fillStyle = colours.sky;
    ctx.fillRect(0, 0, w, WORLD.height);
    // Clouds drift slower than the beach; the far headland and its lighthouse slower still.
    ctx.fillStyle = colours.cloud;
    for (const [x, y, r] of [
      [120, 56, 26],
      [430, 34, 20],
      [760, 70, 24],
    ] as const) {
      const cx = ((((x - drift * 0.05 - now * (reduced.matches ? 0 : 0.004)) % (w + 120)) + w + 120) % (w + 120)) - 60;
      ctx.beginPath();
      ctx.ellipse(cx, y, r * 1.8, r * 0.45, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + r * 0.8, y - 6, r, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const seaTop = groundY() - 58;
    ctx.fillStyle = colours.sea;
    ctx.fillRect(0, seaTop, w, groundY() - seaTop);
    ctx.beginPath();
    ctx.moveTo(0, seaTop);
    ctx.lineTo(w, seaTop);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colours.seaDeep;
    ctx.stroke();
    const headland = (((w * 0.78 - drift * 0.1) % (w + 300)) + w + 300) % (w + 300) - 150;
    ctx.beginPath();
    ctx.moveTo(headland - 110, seaTop + 1);
    ctx.quadraticCurveTo(headland, seaTop - 46, headland + 120, seaTop + 1);
    ctx.fillStyle = colours.limestone;
    ctx.fill();
    outline(1.6);
    ctx.beginPath();
    ctx.moveTo(headland - 6, seaTop - 30);
    ctx.lineTo(headland - 4, seaTop - 60);
    ctx.lineTo(headland + 6, seaTop - 60);
    ctx.lineTo(headland + 8, seaTop - 30);
    ctx.closePath();
    ctx.fillStyle = colours.sky;
    ctx.fill();
    outline(1.6);
    ctx.beginPath();
    ctx.moveTo(headland - 6, seaTop - 60);
    ctx.quadraticCurveTo(headland + 1, seaTop - 68, headland + 8, seaTop - 60);
    ctx.closePath();
    ctx.fillStyle = colours.accent;
    ctx.fill();
    outline(1.6);
    // Waves roll by with the beach.
    ctx.strokeStyle = colours.seaLine;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 8; i++) {
      const x = ((((i * 137 - drift * 0.35) % (w + 40)) + w + 40) % (w + 40)) - 20;
      const y = seaTop + 12 + ((i * 17) % 26);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 8, y - 4, x + 16, y);
      ctx.stroke();
    }
    // The dunes behind the beach, with scrub, passing at half its speed.
    const duneTop = groundY() - 24;
    const dune = (x: number) => duneTop + Math.sin((x + drift * 0.5) / 70) * 4 + Math.sin((x + drift * 0.5) / 23) * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, groundY());
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, dune(x));
    ctx.lineTo(w, groundY());
    ctx.closePath();
    ctx.fillStyle = colours.limestone;
    ctx.fill();
    ctx.beginPath();
    for (let x = 0; x <= w + 8; x += 8) (x === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, x, dune(x));
    outline(1.6);
    ctx.fillStyle = colours.olive;
    for (let i = 0; i < 5; i++) {
      const x = ((((i * 233 + 60 - drift * 0.5) % (w + 80)) + w + 80) % (w + 80)) - 40;
      ctx.beginPath();
      ctx.ellipse(x, dune(x) + 2, 20, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      outline(1.4);
    }
    // The sand, with a few pebbles going past at the beach's own speed.
    ctx.fillStyle = colours.sand;
    ctx.fillRect(0, groundY(), w, WORLD.height - groundY());
    ctx.beginPath();
    ctx.moveTo(0, groundY());
    ctx.lineTo(w, groundY());
    outline(2);
    ctx.fillStyle = colours.limestone;
    for (let i = 0; i < 9; i++) {
      const x = ((((i * 97 - game.distance) % (w + 30)) + w + 30) % (w + 30)) - 15;
      ctx.beginPath();
      ctx.ellipse(x, groundY() + 14 + ((i * 11) % 22), 3 + (i % 3), 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function obstacle(o: Obstacle, now: number) {
    const base = groundY();
    const { x, w, h } = o;
    ctx.beginPath();
    if (o.kind === 'gull') {
      gull(o, now);
      return;
    }
    if (o.kind === 'branch') {
      branch(o);
      return;
    }
    if (o.kind === 'rock') {
      ctx.moveTo(x, base);
      ctx.bezierCurveTo(x - 2, base - h * 0.8, x + w * 0.35, base - h * 1.05, x + w * 0.6, base - h);
      ctx.bezierCurveTo(x + w * 0.95, base - h * 0.9, x + w + 2, base - h * 0.4, x + w, base);
      ctx.closePath();
      ctx.fillStyle = colours.limestone;
      ctx.fill();
      outline();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, base - h * 0.55);
      ctx.lineTo(x + w * 0.45, base - h * 0.4);
      outline(2);
    } else if (o.kind === 'bush') {
      // Three clumps, back to front, so each covers the outline of the one behind it.
      for (const [cx, cy, r] of [
        [0.26, 0.42, 0.34],
        [0.78, 0.4, 0.3],
        [0.52, 0.6, 0.38],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x + w * cx, base - h * cy, w * r, 0, Math.PI * 2);
        ctx.fillStyle = cx === 0.52 ? colours.oliveBright : colours.olive;
        ctx.fill();
        outline();
      }
      ctx.beginPath();
    } else if (o.kind === 'log') {
      ctx.roundRect(x, base - h, w, h, h / 2);
      ctx.fillStyle = colours.wood;
      ctx.fill();
      outline();
      ctx.beginPath();
      ctx.ellipse(x + w - h / 2, base - h / 2, h / 4, h / 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = colours.limestone;
      ctx.fill();
      outline(2);
    } else {
      // A sandcastle: two towers and a flag.
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - h * 0.62);
      for (let i = 0; i < 4; i++) {
        const step = w / 4;
        ctx.lineTo(x + step * i, base - h * (i % 2 ? 0.62 : 0.74));
        ctx.lineTo(x + step * (i + 0.5), base - h * (i % 2 ? 0.62 : 0.74));
      }
      ctx.lineTo(x + w, base - h * 0.62);
      ctx.lineTo(x + w, base);
      ctx.closePath();
      ctx.fillStyle = colours.limestone;
      ctx.fill();
      outline();
      ctx.beginPath();
      ctx.moveTo(x + w / 2, base - h * 0.74);
      ctx.lineTo(x + w / 2, base - h);
      outline(2);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, base - h);
      ctx.lineTo(x + w / 2 + 14, base - h * 0.92);
      ctx.lineTo(x + w / 2, base - h * 0.84);
      ctx.closePath();
      ctx.fillStyle = colours.accent;
      ctx.fill();
      outline(2);
    }
  }

  /** A gull flying low along the beach toward the quokka, wings beating (still under reduced
   * motion). Its underside is the obstacle's: duck under it. */
  function gull(o: Obstacle, now: number) {
    const under = groundY() - o.lift;
    const cx = o.x + o.w / 2;
    const cy = under - 9;
    const flap = reduced.matches ? 0.5 : (Math.sin(now / 85) + 1) / 2;
    // The far wing, the body, the head and beak, then the near wing over the body.
    const wing = (dx: number, lift: number) => {
      ctx.beginPath();
      ctx.moveTo(cx + dx - 10, cy - 2);
      ctx.quadraticCurveTo(cx + dx + 2, cy - 10 - lift * 16, cx + dx + 16, cy - 6 - lift * 22);
      ctx.quadraticCurveTo(cx + dx + 8, cy - 2, cx + dx + 4, cy);
      ctx.closePath();
      ctx.fillStyle = colours.cloud;
      ctx.fill();
      outline(2);
    };
    wing(6, 1 - flap);
    ctx.beginPath();
    ctx.ellipse(cx, cy, o.w * 0.36, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = colours.sky;
    ctx.fill();
    outline(2.4);
    ctx.beginPath();
    ctx.arc(cx - o.w * 0.34, cy - 5, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = colours.sky;
    ctx.fill();
    outline(2.4);
    ctx.beginPath();
    ctx.moveTo(cx - o.w * 0.34 - 6, cy - 6);
    ctx.lineTo(cx - o.w * 0.34 - 15, cy - 3);
    ctx.lineTo(cx - o.w * 0.34 - 6, cy - 1);
    ctx.closePath();
    ctx.fillStyle = colours.accent;
    ctx.fill();
    outline(1.8);
    ctx.beginPath();
    ctx.arc(cx - o.w * 0.36, cy - 7, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = colours.ink;
    ctx.fill();
    // A tail to the right, then the near wing.
    ctx.beginPath();
    ctx.moveTo(cx + o.w * 0.32, cy - 2);
    ctx.lineTo(cx + o.w * 0.5, cy - 6);
    ctx.lineTo(cx + o.w * 0.48, cy + 3);
    ctx.closePath();
    ctx.fillStyle = colours.cloud;
    ctx.fill();
    outline(2);
    wing(-2, flap);
  }

  /** A low branch reaching down from a tree off the top of the stage, its leaves hanging to
   * the obstacle's underside: duck under it. */
  function branch(o: Obstacle) {
    const under = groundY() - o.lift;
    const { x, w } = o;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.92, -6);
    ctx.bezierCurveTo(x + w * 0.9, under * 0.45, x + w * 0.55, under - 40, x + w * 0.1, under - 22);
    ctx.lineWidth = 13;
    ctx.strokeStyle = colours.ink;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = colours.woodDark;
    ctx.stroke();
    // Leaves hanging from its lower end, pointed like the footer's, their tips at the underside.
    for (const [px, len, angle, bright] of [
      [0.08, 30, 1.25, false],
      [0.26, 34, 1.5, true],
      [0.44, 30, 1.75, false],
      [0.17, 22, 1.95, true],
      [0.36, 24, 1.1, false],
      [0.56, 22, 1.45, true],
    ] as const) {
      const ax = x + w * px;
      const ay = under - Math.sin(angle) * len;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len / 2, -len / 3.2, len, 0);
      ctx.quadraticCurveTo(len / 2, len / 3.2, 0, 0);
      ctx.fillStyle = bright ? colours.oliveBright : colours.olive;
      ctx.fill();
      outline(2);
      ctx.restore();
    }
    ctx.beginPath();
  }

  function quokka(now: number) {
    const base = groundY();
    const { runner } = game;
    const running = game.status === 'running' && runner.grounded && !reduced.matches;
    // Ducked it slides low and long along the sand (or tucks up in the air).
    const squash = runner.ducking ? { x: 1.16, y: WORLD.duckH / WORLD.runnerH } : { x: 1, y: 1 };
    const bob = running && !runner.ducking ? Math.abs(Math.sin(now / 90)) * 4 : 0;
    // The pose's 512 canvas holds the quokka in its middle (src/quokka/rig.ts LAYERED.walking).
    const size = WORLD.runnerH / (436 / 512);
    const x = WORLD.runnerX + WORLD.runnerW / 2;
    const feet = base - runner.y - bob;
    ctx.save();
    ctx.translate(x, feet);
    if (!runner.grounded) ctx.rotate(runner.vy > 0 ? -0.18 : 0.12);
    if (game.status === 'over') ctx.rotate(0.35);
    ctx.scale(squash.x, squash.y);
    if (runnerArt) {
      // The pose's feet sit at 470/512, its body centred near 242/512.
      ctx.drawImage(runnerArt, -size * (242 / 512), -size * (470 / 512), size, size);
    } else {
      ctx.beginPath();
      ctx.ellipse(0, -WORLD.runnerH / 2, WORLD.runnerW / 2, WORLD.runnerH / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = colours.cocoa;
      ctx.fill();
      outline();
    }
    ctx.restore();
    // A little sand kicked up on landing and while running.
    if (running && !reduced.matches) {
      ctx.fillStyle = colours.limestone;
      const puff = (now / 120) % 1;
      ctx.beginPath();
      ctx.arc(x - 26 - puff * 18, base - 4 - puff * 6, 3 * (1 - puff), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(now: number) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    backdrop(now);
    for (const o of game.obstacles) obstacle(o, now);
    quokka(now);
    // Paused or over, the sky behind the overlay's words is washed back so a branch or a gull
    // passing behind them never crosses a line of text.
    if (game.status === 'paused' || game.status === 'over') {
      const bottom = groundY() - 40;
      const wash = ctx.createLinearGradient(0, 0, 0, bottom);
      wash.addColorStop(0, colours.sky);
      wash.addColorStop(0.7, colours.sky);
      wash.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, game.width, bottom);
      ctx.globalAlpha = 1;
    }
  }

  // ——— The run ———

  function showScore() {
    const score = metres(game.distance);
    if (score !== shownScore) {
      shownScore = score;
      scoreEl!.textContent = String(score);
    }
    bestEl!.textContent = String(game.best);
    stage.dataset.hasBest = game.best > 0 ? 'true' : 'false';
    const now = level(game.distance);
    if (levelEl && now !== shownLevel) {
      // A new level lights up for a moment (a fresh run quietly starts again at 1).
      if (now > shownLevel) {
        levelEl.classList.add('is-up');
        clearTimeout(levelUpTimer);
        levelUpTimer = window.setTimeout(() => levelEl.classList.remove('is-up'), 1400);
      }
      shownLevel = now;
      levelEl.textContent = String(now);
    }
  }

  function setDuck(down: boolean) {
    game = duck(game, down);
    stage.dataset.ducking = game.runner.ducking ? 'true' : 'false';
  }

  function setOverlay(state: 'ready' | 'paused' | 'over') {
    overlay!.hidden = false;
    stage.dataset.state = state;
    note!.hidden = state === 'ready';
    if (state === 'ready') {
      title!.textContent = 'Help the quokka home';
      play!.textContent = 'Play';
    } else if (state === 'paused') {
      title!.textContent = 'Paused';
      note!.textContent = `${metres(game.distance)} m so far, level ${level(game.distance)}.`;
      play!.textContent = 'Keep going';
    } else {
      title!.textContent = `${metres(game.distance)} m`;
      note!.textContent =
        metres(game.distance) >= game.best && game.best > 0 ? 'Your best run this visit.' : `Best this visit: ${game.best} m.`;
      play!.textContent = 'Play again';
      if (announce) announce.textContent = `The quokka tripped after ${metres(game.distance)} metres. Play again?`;
    }
  }

  function loop(now: number) {
    const ms = now - last;
    last = now;
    game = step(game, ms, Math.random);
    draw(now);
    showScore();
    if (game.status === 'over') {
      raf = 0;
      setOverlay('over');
      play!.focus();
      return;
    }
    raf = game.status === 'running' ? requestAnimationFrame(loop) : 0;
  }

  function run() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function begin() {
    game = game.status === 'paused' ? resume(game) : start(game);
    overlay!.hidden = true;
    stage.dataset.state = 'running';
    stage.dataset.ducking = 'false';
    if (announce) announce.textContent = '';
    stage.focus({ preventScroll: true });
    run();
  }

  function hold() {
    duckPointer = null;
    press = null;
    if (game.status !== 'running') return;
    game = pause(game);
    stage.dataset.ducking = 'false';
    cancelAnimationFrame(raf);
    raf = 0;
    setOverlay('paused');
    draw(performance.now());
  }

  play.addEventListener('click', begin);
  // Focus leaving the stage (a Tab, a click elsewhere) pauses the run rather than letting the
  // quokka trip while nobody can jump.
  stage.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !stage.contains(next)) hold();
  });
  const isDuckKey = (key: string) => key === 'ArrowDown' || key === 's' || key === 'S';
  stage.addEventListener('keydown', (event) => {
    if (event.target !== stage) return; // the overlay's button keeps its own keys
    if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      if (!event.repeat) game = jump(game);
    } else if (isDuckKey(event.key)) {
      event.preventDefault();
      setDuck(true);
    } else if (event.key === 'Escape' || event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      hold();
      play!.focus();
    }
  });
  stage.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') game = release(game);
    else if (isDuckKey(event.key)) setDuck(false);
  });
  // A press on the sand (the lower third) ducks while held; anywhere higher jumps, and a
  // swipe down from there ducks too (tucking in the air drops the quokka fast).
  canvas.addEventListener('pointerdown', (event) => {
    if (game.status !== 'running') return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    const box = canvas.getBoundingClientRect();
    press = { id: event.pointerId, y: event.clientY };
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks: pointerup still arrives on the canvas.
    }
    if (event.clientY - box.top > box.height * (2 / 3)) {
      duckPointer = event.pointerId;
      setDuck(true);
    } else {
      game = jump(game);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id || duckPointer !== null) return;
    if (event.clientY - press.y > 24) {
      duckPointer = event.pointerId;
      setDuck(true);
    }
  });
  const lift = (event: PointerEvent) => {
    if (press?.id === event.pointerId) press = null;
    game = release(game);
    if (duckPointer === event.pointerId) {
      duckPointer = null;
      setDuck(false);
    }
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  // Hidden or scrolled away: a run pauses itself and waits for the visitor.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hold();
  });
  new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((entry) => entry.intersectionRatio >= 0.5);
      if (!onScreen) hold();
    },
    { threshold: [0, 0.5, 1] },
  ).observe(stage);
  window.addEventListener('resize', resize);
  reduced.addEventListener('change', () => draw(performance.now()));

  stage.classList.add('is-live');
  stage.dataset.ducking = 'false';
  setOverlay('ready');
  resize();
  showScore();
  colours = palette();
}
