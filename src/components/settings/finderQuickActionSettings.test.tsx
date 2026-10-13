import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { QUICK_ACTION_LABELS as L, type QuickActionView, QuickActionRow } from "./finderQuickActionSettings";

const row = (view: QuickActionView, native = true) =>
  renderToStaticMarkup(<QuickActionRow native={native} view={view} onSet={() => {}} />);

test("the Quick Action row offers Add only when nothing is installed", () => {
  const html = row({ kind: "ready", status: "absent" });
  expect(html).toContain(L.add);
  expect(html).not.toContain(L.remove);
});

test("an installed Quick Action says where it lives and offers Remove", () => {
  const html = row({ kind: "ready", status: "installed" });
  expect(html).toContain("Quick Actions → Open in Rotli");
  expect(html).toContain(L.remove);
  expect(html).not.toContain(L.add);
});

test("a same-named workflow of the person's own is left alone: no button", () => {
  const html = row({ kind: "ready", status: "theirs" });
  expect(html).toContain("Rotli leaves it alone");
  expect(html).not.toContain("<button");
});

test("busy, error, checking, and the web each say what's happening", () => {
  expect(row({ kind: "busy", status: "absent" })).toContain(L.adding);
  expect(row({ kind: "busy", status: "installed" })).toContain(L.removing);
  const failed = row({ kind: "error", status: "absent", message: "permission denied" });
  expect(failed).toContain("Couldn’t change the Quick Action — permission denied");
  expect(failed).toContain(L.add);
  expect(row({ kind: "checking" })).toContain("Checking Finder…");
  expect(row({ kind: "ready", status: "absent" }, false)).toContain("In the Mac app.");
});
