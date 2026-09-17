// WHO answers a chat, written into the chat's own file (`model:` and
// `provider:` frontmatter) so a copied or connected vault shows the right mark
// without this device's settings.json (the owner, 2026-09-17: the web showed
// every chat as Claude). Two entry points: the surface calls `sync` when a
// chat's model is picked or pinned at send; `backfill` runs once per vault per
// session and stamps the chats that predate the fields from the settings map
// this device still holds. Both are best-effort metadata: a failed write is
// swallowed, the chat itself is untouched.

import { type HybridPreset, modelProvider } from "../ai/models";
import type { ChatModelInfo, MemexChatSummary } from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import { setChatModelMeta } from "../memex/service";
import { chatKey } from "../state/ui";

export async function syncChatModelMeta(
  instance: MemexInstance | null,
  slug: string | null | undefined,
  modelId: string,
  models: readonly ChatModelInfo[],
  presets: readonly HybridPreset[],
): Promise<void> {
  if (!instance || !slug || !modelId) return;
  const provider = modelProvider(modelId, models, presets) ?? null;
  try {
    await setChatModelMeta(instance, slug, modelId, provider);
  } catch {
    // metadata only — the chat and its transcript are untouched
  }
}

/** The chats whose files lack a model but whose model this device knows. */
export function chatsNeedingModel(
  instanceId: string,
  chats: readonly MemexChatSummary[],
  chatModelMap: Readonly<Record<string, string>>,
): { slug: string; modelId: string }[] {
  return chats.flatMap((chat) => {
    if (chat.model) return [];
    const modelId = chatModelMap[chatKey(instanceId, chat.slug, "")];
    return modelId ? [{ slug: chat.slug, modelId }] : [];
  });
}

const backfilled = new Set<string>();

/** Once per vault per session: write the model each chat ran on into the
 * chats that predate the frontmatter, from this device's settings map. */
export async function backfillChatModels(
  instance: MemexInstance,
  chats: readonly MemexChatSummary[],
  chatModelMap: Readonly<Record<string, string>>,
  models: readonly ChatModelInfo[],
  presets: readonly HybridPreset[],
): Promise<number> {
  if (backfilled.has(instance.id)) return 0;
  const pending = chatsNeedingModel(instance.id, chats, chatModelMap);
  backfilled.add(instance.id);
  for (const { slug, modelId } of pending) await syncChatModelMeta(instance, slug, modelId, models, presets);
  return pending.length;
}
