import { describe, expect, test } from "bun:test";

import { siteRemoteImageCspFindings } from "./site-csp.mjs";

const caddyfile = (imageSources: string) =>
  `Content-Security-Policy "default-src 'self'; img-src ${imageSources}; object-src 'none'"`;

describe("public-site image CSP", () => {
  test("accepts a remote image only when its exact origin is declared", () => {
    const sources = [
      {
        path: "site/src/components/SiteFooter.astro",
        contents: '<img src="https://tools.launchllama.co/featured-badge.png?v=2" />',
      },
    ];

    expect(siteRemoteImageCspFindings(caddyfile("'self' https://tools.launchllama.co"), sources)).toEqual([]);
  });

  test("reports a remote image that production would block", () => {
    const sources = [
      {
        path: "site/src/components/SiteFooter.astro",
        contents: '<img src="https://tools.launchllama.co/featured-badge.png?v=2" />',
      },
    ];

    expect(siteRemoteImageCspFindings(caddyfile("'self' data:"), sources)).toEqual([
      'site/src/components/SiteFooter.astro: remote <img> origin "https://tools.launchllama.co" is not allowed by site/Caddyfile img-src.',
    ]);
  });

  test("ignores same-origin images and ordinary external links", () => {
    const sources = [
      {
        path: "site/src/components/Footer.astro",
        contents: '<a href="https://example.com"><img src="/badge.png" alt="Badge" /></a>',
      },
    ];

    expect(siteRemoteImageCspFindings(caddyfile("'self' data:"), sources)).toEqual([]);
  });
});
