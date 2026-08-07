/** Mirror the registered browser-style tab chords on the tabs they target:
 * ⌘1–⌘8 address fixed positions and ⌘9 addresses the last tab. A shorter
 * strip labels its last tab by position because that is the more precise key. */
export function tabHotkeyAction(index: number, tabCount: number): string | undefined {
  if (index < 8) return `tabs.jump${index + 1}`;
  if (index === tabCount - 1) return "tabs.last";
  return undefined;
}
