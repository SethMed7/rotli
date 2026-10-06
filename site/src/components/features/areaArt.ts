// Each catalog area's quokka: the app's own character art (filled, cocoa), the pose that
// fits the area (src/og.ts POSES describes each). Images live here, not in src/features.ts,
// so the data stays importable by the root tests.
import aiChat from '../../../../src/assets/characters/filled/cocoa/ai_chat.webp';
import board from '../../../../src/assets/characters/filled/cocoa/excalidraw_board.webp';
import knowledge from '../../../../src/assets/characters/filled/cocoa/knowledge_system.webp';
import notes from '../../../../src/assets/characters/filled/cocoa/notes.webp';
import searching from '../../../../src/assets/characters/filled/cocoa/searching.webp';
import staysLocal from '../../../../src/assets/characters/filled/cocoa/stays_local.webp';
import type { Pose } from '../../features';

export const POSE_ART: Record<Pose, { src: string }> = {
  notes,
  knowledge_system: knowledge,
  ai_chat: aiChat,
  excalidraw_board: board,
  stays_local: staysLocal,
  searching,
};
