import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ChatClarificationBar } from "./chatClarificationBar";

test("every option is a real button and the prompt is the section's text", () => {
  const html = renderToStaticMarkup(
    <ChatClarificationBar
      question={{ prompt: "Which vault?", options: ["Work", "Personal"] }}
      onAnswer={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Choose an answer"');
  expect(html).toContain("<p>Which vault?</p>");
  expect(html.match(/<button type="button"/g)?.length).toBe(2);
  expect(html).toContain(">Work</button>");
  expect(html).toContain(">Personal</button>");
});
