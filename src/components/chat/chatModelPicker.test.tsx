import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { ModelGroups } from "../../ai/models";
import { ModelPicker, shortModelLabel } from "./chatModelPicker";

type ChatModelInfo = ModelGroups["local"][number];

const model = (over: Partial<ChatModelInfo>): ChatModelInfo => ({
  id: "m",
  label: "m",
  provider: "mlx",
  endpoint: "",
  api: "",
  vision: false,
  isDefault: false,
  ...over,
});

describe("shortModelLabel", () => {
  test("drops the transport suffix and quant noise", () => {
    expect(shortModelLabel("gemma-3-12b-it-qat-4bit · MLX")).toBe("gemma-3-12b");
    expect(shortModelLabel("qwen-2.5-7b-instruct-4bit · llama.cpp")).toBe("qwen-2.5-7b");
  });

  test("leaves a connected model's name alone", () => {
    expect(shortModelLabel("Claude Opus")).toBe("Claude Opus");
  });
});

describe("ModelPicker trigger", () => {
  test("names the picked model and stays closed until clicked", () => {
    const local = model({ id: "gemma", label: "gemma-3-12b-it-qat-4bit · MLX" });
    const markup = renderToStaticMarkup(
      <ModelPicker
        groups={{ local: [local], connected: [], presets: [] }}
        picked={local}
        onPick={() => undefined}
      />,
    );
    expect(markup).toContain(">gemma-3-12b<");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("chat-modelpop");
  });

  test("an unavailable saved model shows the fallback badge on the trigger", () => {
    const local = model({ id: "gemma", label: "gemma" });
    const markup = renderToStaticMarkup(
      <ModelPicker
        groups={{ local: [local], connected: [], presets: [] }}
        picked={local}
        fallbackFrom="gone-model · MLX"
        onPick={() => undefined}
      />,
    );
    expect(markup).toContain("chat-model-fallback");
    expect(markup).toContain("Saved model “gone-model” is unavailable");
  });
});
