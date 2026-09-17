import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const surfaceSource = readFileSync(new URL("chatSurface.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../../styles/memex.css", import.meta.url), "utf8");

test("the new-chat name is a real field only until the first prompt", () => {
  expect(surfaceSource).toContain("placeholder={CHAT_TITLE_PLACEHOLDER}");
  expect(surfaceSource).toContain('!chatSlug && !hasSentPrompt && chatNaming === "ask"');
  expect(surfaceSource).toContain('<span className="chat-title-h">{provisionalDisplayTitle}</span>');
  expect(surfaceSource).not.toContain("chat-title-skip");

  const fieldRule = stylesSource.slice(
    stylesSource.indexOf(".chat-title-field {"),
    stylesSource.indexOf(".chat-title-field:hover"),
  );
  expect(fieldRule).toContain("border: 1px solid var(--border)");
  expect(fieldRule).toContain("background: var(--surface-2)");
  expect(fieldRule).toContain("width: min(320px, 60cqw)");
});

test("the fresh-chat composition is lower, narrower, and shorter than an active chat", () => {
  const conversationRule = stylesSource.slice(
    stylesSource.indexOf(".chat-conversation.is-new {"),
    stylesSource.indexOf(".chat-artifacts-panel"),
  );
  expect(conversationRule).toContain("padding-block: clamp(96px, 24cqh, 240px) 32px");
  expect(surfaceSource).not.toContain("Ask, make, or search across this vault.");

  const composerRule = stylesSource.slice(
    stylesSource.indexOf(".chat-conversation.is-new .chat-composer-inner"),
    stylesSource.indexOf(".chat-question-wrap"),
  );
  expect(composerRule).toContain("max-width: 700px");

  const messageRule = stylesSource.slice(
    stylesSource.indexOf(".chat-conversation.is-new .chat-msg"),
    stylesSource.indexOf(".chat-question-wrap"),
  );
  expect(messageRule).toContain("min-height: 30px");
});

test("dropped chat images read back over IPC bytes, never a webview fetch", () => {
  // connect-src is ipc-only (docs/development/security.md): fetch(asset://…)
  // fails with "Load failed" after the file has already been copied in.
  const attach = surfaceSource.slice(
    surfaceSource.indexOf("const attachPaths = useCallback("),
    surfaceSource.indexOf("const assetPrefix ="),
  );
  expect(surfaceSource).not.toMatch(/(^|[^.\w])fetch\s*\(/);
  expect(attach).toContain("corpusFileBytes(id, CHAT_IMAGE_ASSET_MAX_BYTES)");
});
