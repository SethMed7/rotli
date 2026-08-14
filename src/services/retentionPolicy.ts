/** Automatic cleanup policy. This module decides eligibility only; callers
 * choose the narrow, recoverable operation (unlink a Main reference or archive
 * a chat). Invalid/missing timestamps fail closed and are never selected. */

export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;

export interface RetentionCandidate {
  updatedAt: number;
  viewedAt?: number;
  pinned?: boolean;
  open?: boolean;
}

export function parseRetentionDays(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const days = Math.floor(value);
  return days >= 1 && days <= MAX_RETENTION_DAYS ? days : null;
}

export function isRetentionEligible(
  candidate: RetentionCandidate,
  days: number | null,
  now = Date.now(),
): boolean {
  if (days === null || candidate.pinned || candidate.open) return false;
  if (!Number.isFinite(candidate.updatedAt) || candidate.updatedAt <= 0) return false;
  const viewedAt =
    typeof candidate.viewedAt === "number" && Number.isFinite(candidate.viewedAt) ? candidate.viewedAt : 0;
  const lastActivity = Math.max(candidate.updatedAt, viewedAt);
  return lastActivity <= now - days * 24 * 60 * 60 * 1000;
}
