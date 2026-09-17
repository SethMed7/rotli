// WHO answers a chat, written into the chat's own file (`model:` and
// `provider:` frontmatter) so a copied or connected vault shows the right mark
// without this device's settings.json (the owner, 2026-09-17: the web showed
// every chat as Claude). Two entry points: the surface calls `sync` when a
// chat's model is picked or pinned at send; `backfill` runs once per vault per
// session and completes every chat whose file is missing either line — from
// the settings map this device holds, else the vault's default model (the
// mark the app shows for such a chat). Both are best-effort metadata: a
// failed write is swallowed, the chat itself is untouched.

import { type HybridPreset, legacyModelProvider, modelProvider } from "../ai/models";
import type { ChatModelInfo, MemexChatSummary } from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import { setChatModelMeta } from "../memex/service";
import { chatKey } from "../state/ui";

/** The lane a model id belongs to — the catalogs first, then the legacy
 * label shapes the old picker stored, so "Gemini 3.5 Flash (Medium)" carries
 * `provider: antigravity` like the mark it wears. */
export function providerOf(
  modelId: string,
  models: readonly ChatModelInfo[],
  presets: readonly HybridPreset[],
): string | null {
  return modelProvider(modelId, models, presets) ?? legacyModelProvider(modelId) ?? null;
}

export async function syncChatModelMeta(
  instance: MemexInstance | null,
  slug: string | null | undefined,
  modelId: string,
  models: readonly ChatModelInfo[],
  presets: readonly HybridPreset[],
): Promise<void> {
  if (!instance || !slug || !modelId) return;
  try {
    await setChatModelMeta(instance, slug, modelId, providerOf(modelId, models, presets));
  } catch {
    // metadata only — the chat and its transcript are untouched
  }
}

/** The chats whose file lacks a model or a provider, with the model to write:
 * the file's own, else this device's map, else the vault's default. */
export function chatsToStamp(
  instanceId: string,
  chats: readonly MemexChatSummary[],
  chatModelMap: Readonly<Record<string, string>>,
  defaultModel: string,
): { slug: string; modelId: string }[] {
  return chats.flatMap((chat) => {
    if (chat.model && chat.provider) return [];
    // the default stands in only where this device's map exists at all: a
    // copy that lost its settings (a stale browser-storage vault, an import
    // without .rotli/) must not be stamped "the default" on every chat
    const fallback = Object.keys(chatModelMap).length > 0 ? defaultModel : "";
    const modelId = chat.model || chatModelMap[chatKey(instanceId, chat.slug, "")] || fallback;
    return modelId ? [{ slug: chat.slug, modelId }] : [];
  });
}

const backfilled = new Set<string>();

/** Once per vault per session: complete the model and provider lines of the
 * chats that lack them. A write happens only where the file would change. */
export async function backfillChatModels(
  instance: MemexInstance,
  chats: readonly MemexChatSummary[],
  chatModelMap: Readonly<Record<string, string>>,
  defaultModel: string,
  models: readonly ChatModelInfo[],
  presets: readonly HybridPreset[],
): Promise<number> {
  if (backfilled.has(instance.id)) return 0;
  const pending = chatsToStamp(instance.id, chats, chatModelMap, defaultModel);
  backfilled.add(instance.id);
  for (const { slug, modelId } of pending) await syncChatModelMeta(instance, slug, modelId, models, presets);
  return pending.length;
}
