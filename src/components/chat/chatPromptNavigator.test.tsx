import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

test("every visible prompt marker is its own labeled control and the active marker is semantic", async () => {
  const runtimeGlobal = globalThis as typeof globalThis & { window?: unknown };
  const hadWindow = Object.prototype.hasOwnProperty.call(runtimeGlobal, "window");
  const previousWindow = runtimeGlobal.window;
  Object.defineProperty(runtimeGlobal, "window", { configurable: true, value: {} });

  try {
    const { ChatPromptNavigator } = await import("./chatPromptNavigator");
    const markup = renderToStaticMarkup(
      <ChatPromptNavigator
        prompts={[
          { messageIndex: 0, text: "First" },
          { messageIndex: 2, text: "Second" },
          { messageIndex: 4, text: "Third" },
        ]}
        activeMessageIndex={2}
        onJump={() => undefined}
      />,
    );

    expect(markup.match(/class="chat-prompt-marker/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="Preview prompt: Second" aria-current="location"');
    expect(markup).not.toContain('title="Second"');
  } finally {
    if (hadWindow)
      Object.defineProperty(runtimeGlobal, "window", { configurable: true, value: previousWindow });
    else Reflect.deleteProperty(runtimeGlobal, "window");
  }
});
