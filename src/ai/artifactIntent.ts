/** Deterministic format/capability questions that must happen before a model
 * can substitute one durable file type for another. The model still decides
 * content; Rotli owns the product-format contract. */

import type { AgentQuestion } from "./types";

const CREATION = /\b(?:create|make|generate|draft|write|build|open up|put together)\b/i;
const WORD = /\b(?:word(?:\s+(?:doc|document))?|docx|\.docx)\b/i;
const GENERIC_DOCUMENT = /\b(?:doc|document)\b/i;
const MARKDOWN = /\b(?:markdown|\.md|note)\b/i;

export function artifactClarification(
  userText: string,
  capabilities: { documentTool: boolean },
): ({ kind: "question" } & AgentQuestion) | { kind: "final"; text: string } | null {
  const text = userText.trim();
  if (!text || !CREATION.test(text) || !GENERIC_DOCUMENT.test(text)) return null;

  const explicitlyWord = WORD.test(text);
  const explicitlyMarkdown = MARKDOWN.test(text);
  if (!explicitlyWord && !explicitlyMarkdown) {
    return {
      kind: "question",
      prompt: "Before I create it, which format do you want?",
      options: ["Word document (.docx)", "Markdown note (.md)"],
    };
  }

  if (explicitlyWord && !capabilities.documentTool) {
    return {
      kind: "final",
      text: "Editable Word document creation is unavailable in this chat’s current vault. I won’t substitute a Markdown note for it.",
    };
  }

  return null;
}
