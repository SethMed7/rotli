import { afterAll, expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

// A host with no mascot (docs/architecture/host-seams.md, "The look"): no
// quokka anywhere, its own mark where Rotli shows the quokka mark. The host
// and its mark are synthetic.
const registry = { ...(await import("./registry")) };
let mascot = true;
let mark: ((props: { size?: number }) => React.ReactNode) | null = null;
await mock.module("./registry", () => ({
  ...registry,
  mascotShown: () => mascot,
  productMark: () => mark,
}));
const { Character, QuokkaMark } = await import("../components/character");
afterAll(async () => {
  await mock.module("./registry", () => registry);
});

test("standalone Rotli draws its quokka and its quokka mark, as before", () => {
  mascot = true;
  mark = null;
  expect(renderToStaticMarkup(<Character name="waving" size={40} />)).toContain('class="quokka"');
  expect(renderToStaticMarkup(<QuokkaMark size={15} />)).toContain('class="quokka-mark"');
});

test("with no mascot, no quokka draws anywhere, and no mark without the host's own", () => {
  mascot = false;
  mark = null;
  expect(renderToStaticMarkup(<Character name="waving" size={40} />)).toBe("");
  expect(renderToStaticMarkup(<QuokkaMark size={15} />)).toBe("");
});

test("the host's own mark stands where the quokka mark was, at its size", () => {
  mascot = false;
  mark = ({ size }) => <svg data-synthetic-mark={size} />;
  const html = renderToStaticMarkup(<QuokkaMark size={18} className="tb-home-mark" />);
  expect(html).toContain('class="host-product-mark tb-home-mark"');
  expect(html).toContain('data-synthetic-mark="18"');
  expect(html).not.toContain("quokka");
});
