import { expect, test } from "bun:test";

import { appPolicy, privacyViolations } from "./check-web-privacy.mjs";

const GOOD =
  "default-src 'self'; base-uri 'none'; connect-src http://127.0.0.1:*; font-src 'self' data:; form-action 'none'; frame-ancestors 'none'; img-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";

test("the shipped /app/ policy reaches only 127.0.0.1 and loads only its own files", async () => {
  const caddyfile = await Bun.file(new URL("../site/Caddyfile", import.meta.url)).text();
  expect(privacyViolations(appPolicy(caddyfile))).toEqual([]);
  expect(privacyViolations(GOOD)).toEqual([]);
});

test("any outbound host, a wider connect-src, or an open form is refused", () => {
  expect(
    privacyViolations(
      GOOD.replace(
        "connect-src http://127.0.0.1:*",
        "connect-src http://127.0.0.1:* https://api.example.com",
      ),
    ),
  ).toEqual(["connect-src allows https://api.example.com — only http://127.0.0.1:* may be reached"]);
  expect(
    privacyViolations(GOOD.replace("connect-src http://127.0.0.1:*", "connect-src 'self'")),
  ).toHaveLength(1);
  expect(
    privacyViolations(GOOD.replace("script-src 'self'", "script-src 'self' https://cdn.example.com")),
  ).toEqual(["script-src names https://cdn.example.com — the app loads only its own files"]);
  expect(privacyViolations(GOOD.replace("img-src 'self'", "img-src *"))).toHaveLength(1);
  expect(privacyViolations(GOOD.replace("form-action 'none'", "form-action 'self'"))).toEqual([
    "form-action must be 'none'",
  ]);
  expect(privacyViolations(null)).toHaveLength(1);
});
