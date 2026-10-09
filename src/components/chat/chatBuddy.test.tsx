import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ChatBuddy } from "./chatBuddy";

describe("the chat buddy", () => {
  test("wears the moment's pose, with no switch that can hide it", () => {
    const thinking = renderToStaticMarkup(<ChatBuddy moment="thinking" hour={9} size={72} />);
    expect(thinking).toContain('data-pose="thoughtful"');
    expect(thinking).toContain('class="quokka chat-buddy"');
    const done = renderToStaticMarkup(
      <ChatBuddy moment="done" hour={9} size={72} className="chat-endmark" />,
    );
    expect(done).toContain('data-pose="celebrating"');
    expect(done).toContain("chat-buddy chat-endmark");
  });
});
