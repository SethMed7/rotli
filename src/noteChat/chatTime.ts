import type { TimeFormat } from "../state/ui";

/** Format the original persisted send instant. Legacy date-only turns remain
 * readable without pretending Rotli knows a time that was never recorded. */
export function formatChatTime(value: string | undefined, format: TimeFormat): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12",
  }).format(instant);
}
