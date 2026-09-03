import { fileURLToPath } from "node:url";

import sharp from "sharp";

const source = fileURLToPath(new URL("../src/assets/characters/_logo.svg", import.meta.url));
const outputs = [
  { size: 22, target: fileURLToPath(new URL("../src-tauri/icons/tray.png", import.meta.url)) },
  { size: 44, target: fileURLToPath(new URL("../src-tauri/icons/tray@2x.png", import.meta.url)) },
];

for (const { size, target } of outputs) {
  await sharp(source).resize(size, size, { fit: "contain" }).png({ compressionLevel: 9 }).toFile(target);
}

console.log("Built canonical quokka tray icons.");
