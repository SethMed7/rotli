import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { ModelGroups } from "../../ai/models";
import { PAUSED_LABEL } from "../../lib/lanePause";
import { ModelPicker, ModelRow, chooseModel, shortModelLabel } from "./chatModelPicker";

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

describe("a paused lane in the picker", () => {
  const cursor = model({ id: "grok-4.6", label: "Grok 4.6", provider: "cursor", api: "cli" });
  const codex = model({ id: "gpt-5.5", label: "GPT-5.5", provider: "codex", api: "cli" });

  test("its models stay listed but read as paused and can't be chosen", () => {
    const markup = renderToStaticMarkup(
      <ModelRow
        m={cursor}
        selected={false}
        focusable={false}
        owner="Cursor"
        showOwner={false}
        onChoose={() => undefined}
      />,
    );
    expect(markup).toContain(">Grok 4.6<");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(PAUSED_LABEL);
  });

  test("an open lane's model is an ordinary choice", () => {
    const markup = renderToStaticMarkup(
      <ModelRow
        m={codex}
        selected={false}
        focusable={false}
        owner="Codex"
        showOwner={false}
        onChoose={() => undefined}
      />,
    );
    expect(markup).not.toContain("aria-disabled");
    expect(markup).not.toContain(PAUSED_LABEL);
  });

  test("choosing a paused model does nothing", () => {
    const picked: string[] = [];
    expect(chooseModel(cursor, (id) => picked.push(id))).toBe(false);
    expect(chooseModel(codex, (id) => picked.push(id))).toBe(true);
    expect(picked).toEqual(["gpt-5.5"]);
  });
});
