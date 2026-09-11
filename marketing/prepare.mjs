import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
for (const [from, to] of [
  ['../src/brand/fonts/GeneralSans-Variable.woff2', 'GeneralSans.woff2'],
  ['../site/src/assets/characters/cocoa/celebrating.webp', 'quokka.webp'],
  ['../site/public/rotli-playground@3x.png', 'playground.png'],
]) await copyFile(from, `public/${to}`);
