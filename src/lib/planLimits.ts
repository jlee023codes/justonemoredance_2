import { Tier } from "./tier";

// How many dances can sit on My List at once, per tier. A dance already
// on the list (any status, including "none") always counts — this only
// blocks genuinely *new* additions.
const DANCE_LIMITS: Record<Tier, number> = {
  free: 50,
  sync: 75,
  friends: 150,
  pro: Infinity,
};

export function danceLimitFor(tier: Tier): number {
  return DANCE_LIMITS[tier];
}

export function reachedDanceLimit(
  progress: Record<string, unknown>,
  tier: Tier,
): boolean {
  const limit = danceLimitFor(tier);
  return Number.isFinite(limit) && Object.keys(progress).length >= limit;
}

export const DANCE_LIMIT_TITLE = "Your list is full";
export const DANCE_LIMIT_MESSAGE =
  "Upgrade your plan or remove dances from your list to add more.";
