const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SVG_SOURCE_CHARS = 500_000;
const MAX_SVG_NODES = 10_000;
const MAX_SVG_DEPTH = 64;

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "marker",
]);

const PLAIN_ATTRIBUTES = new Set([
  "id",
  "role",
  "aria-label",
  "viewBox",
  "preserveAspectRatio",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "width",
  "height",
  "transform",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-rule",
  "clip-rule",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "fx",
  "fy",
  "fr",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "refX",
  "refY",
  "orient",
]);

const LOCAL_REFERENCE_ATTRIBUTES = new Set(["clip-path", "mask", "marker-start", "marker-mid", "marker-end"]);

const SAFE_PAINT =
  /^(?:none|currentColor|context-fill|context-stroke|transparent|#[0-9a-f]{3,8}|[a-z]+|rgba?\([0-9.,%\s+-]+\)|hsla?\([0-9.,%\s+-]+\)|url\(#[A-Za-z_][\w:.-]*\))$/i;
const LOCAL_REFERENCE = /^url\(#[A-Za-z_][\w:.-]*\)$/;

/** Attribute policy is exported so the adversarial unit suite can exercise the
 * same allowlist without needing a browser DOM in Bun. */
export function svgAttributeAllowed(name: string, value: string, namespace: string | null): boolean {
  if (namespace !== null) return false;
  if (/^on/i.test(name) || name === "style" || name === "href" || name === "src") return false;
  if (name === "fill" || name === "stroke") return SAFE_PAINT.test(value.trim());
  if (LOCAL_REFERENCE_ATTRIBUTES.has(name)) return LOCAL_REFERENCE.test(value.trim());
  // The control characters ARE the subject here: an untrusted SVG attribute
  // carrying them is rejected outright.
  // oxlint-disable-next-line no-control-regex
  return PLAIN_ATTRIBUTES.has(name) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}

/** Parse untrusted XML and rebuild a fresh SVG tree from a strict element and
 * attribute allowlist. No source node is adopted into the live document. */
export function sanitizeSvg(source: string, targetDocument: Document = document): SVGSVGElement {
  if (source.length > MAX_SVG_SOURCE_CHARS) throw new Error("SVG preview is too large");
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("SVG preview contains invalid XML");
  const root = parsed.documentElement;
  if (root.namespaceURI !== SVG_NS || root.localName !== "svg") {
    throw new Error("SVG preview must have one SVG root");
  }

  let nodes = 0;
  const clone = (input: Element, depth: number): Element | null => {
    if (depth > MAX_SVG_DEPTH) throw new Error("SVG preview is nested too deeply");
    if (input.namespaceURI !== SVG_NS || !ALLOWED_ELEMENTS.has(input.localName)) return null;
    nodes += 1;
    if (nodes > MAX_SVG_NODES) throw new Error("SVG preview has too many elements");

    const output = targetDocument.createElementNS(SVG_NS, input.localName);
    for (const attribute of input.attributes) {
      if (svgAttributeAllowed(attribute.name, attribute.value, attribute.namespaceURI)) {
        output.setAttribute(attribute.name, attribute.value);
      }
    }
    for (const child of input.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const safe = clone(child as Element, depth + 1);
        if (safe) output.appendChild(safe);
      } else if (child.nodeType === Node.TEXT_NODE) {
        output.appendChild(targetDocument.createTextNode(child.textContent ?? ""));
      }
    }
    return output;
  };

  return clone(root, 0) as SVGSVGElement;
}
