import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { BLOCK_NOTICES } from "../../ai/remoteBlock";
import {
  ChatBlockedBar,
  ChatEditPermission,
  lastBlocked,
  PERMISSION_LABELS as L,
  typedConsent,
} from "./chatPermissionBar";

test("a held-back message at the end of the thread is found with the words the person typed", () => {
  const thread = [
    { speaker: "you", text: "hi" },
    { speaker: "rotli", text: "hello" },
    { speaker: "you", text: "my card is 4242 4242 4242 4242" },
    { speaker: "rotli", text: `⚠ ${BLOCK_NOTICES.pattern}` },
  ];
  expect(lastBlocked(thread)).toEqual({ kind: "pattern", text: "my card is 4242 4242 4242 4242" });
  expect(lastBlocked(thread.slice(0, 2))).toBeNull();
  expect(lastBlocked([...thread, { speaker: "you", text: "never mind" }])).toBeNull();
  // consent covers the person's own messages and nothing the model said
  expect(typedConsent(thread, ["again"])).toEqual(["hi", "my card is 4242 4242 4242 4242", "again"]);
});

test("only typed text can be sent anyway; secure-note text offers no way around", () => {
  const pattern = renderToStaticMarkup(<ChatBlockedBar kind="pattern" onAction={() => {}} />);
  expect(pattern).toContain(`>${L.sendAnyway}<`);
  expect(pattern).toContain(`>${L.edit}<`);
  expect(pattern).toContain('role="alert"');
  const secure = renderToStaticMarkup(<ChatBlockedBar kind="secure" onAction={() => {}} />);
  expect(secure).not.toContain(L.sendAnyway);
  expect(secure).toContain(`>${L.edit}<`);
  expect(renderToStaticMarkup(<ChatBlockedBar kind="warming" onAction={() => {}} />)).toContain(
    `>${L.retry}<`,
  );
});

test("the edit card asks like a code editor; a turned-off note can't be allowed once", () => {
  const request = { id: "n1", title: "Thought of the day", revoked: false };
  const card = renderToStaticMarkup(<ChatEditPermission request={request} allowOnce onAnswer={() => {}} />);
  for (const label of [L.once, L.always, L.no]) expect(card).toContain(label);
  expect(card).toContain("Edit “Thought of the day”?");
  const revoked = renderToStaticMarkup(
    <ChatEditPermission request={{ ...request, revoked: true }} allowOnce onAnswer={() => {}} />,
  );
  expect(revoked).not.toContain(L.once);
  expect(revoked).toContain(L.backOn);
});
