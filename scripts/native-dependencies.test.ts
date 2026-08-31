import { expect, test } from "bun:test";

import sharp from "sharp";

test("script-free installs leave native and generated runtime dependencies usable", async () => {
  const [transformers, kokoro] = await Promise.all([
    import("@huggingface/transformers"),
    import("kokoro-js"),
  ]);

  expect(typeof transformers.pipeline).toBe("function");
  expect(typeof kokoro.KokoroTTS).toBe("function");

  const png = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const decoded = await sharp(png).raw().toBuffer({ resolveWithObject: true });

  expect(decoded.info).toMatchObject({ width: 1, height: 1, channels: 4 });
  expect([...decoded.data]).toEqual([1, 2, 3, 255]);
});
