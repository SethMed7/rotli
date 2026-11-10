// The `model:` / `provider:` frontmatter of a chat file — WHO answers this
// chat, kept in the file itself (the owner, 2026-09-17: the web showed every
// chat as Claude because the per-chat model lived only in settings.json,
// which a copied vault does not carry). Same first-frontmatter-block
// discipline as contract.ts's setAttachedTo; a seam because contract.ts sits
// at its size ceiling.

import { frontmatterBlock, withFrontmatterBlock } from "../lib/frontmatterBlock";

/** Rewrite (or insert) the `model:` and `provider:` frontmatter lines on an
 * EXISTING chat file — WHO answers this chat, kept in the file itself.
 * Pure; same first-frontmatter-block discipline as setAttachedTo. An unknown
 * provider drops the line rather than writing a guess. */
export function setChatModel(contents: string, model: string, provider: string | null): string {
  const fm = frontmatterBlock(contents);
  if (!fm) return contents; // no frontmatter — leave the file alone
  let block = fm.inner;
  const put = (key: string, value: string | null) => {
    const re = new RegExp(`^${key}:.*$`, "m");
    if (value === null) block = block.replace(new RegExp(`\\n?^${key}:.*$`, "m"), "");
    else if (re.test(block)) block = block.replace(re, `${key}: ${value}`);
    else block = `${block}\n${key}: ${value}`;
  };
  put("model", model);
  put("provider", provider);
  return withFrontmatterBlock(contents, fm, block);
}
