import { Tier } from "./tier";

// How many dances can sit on My List at once, per tier. A dance already
// on the list (any status, including "none") always counts — this only
// blocks genuinely *new* additions. Free was previously capped at 50;
// removed so My List is unlimited on every tier — sync's 100 stays as
// the one remaining paid-tier distinction.
const DANCE_LIMITS: Record<Tier, number> = {
  free: Infinity,
  sync: 100,
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

// Venues are free for everyone — this just caps how many of a venue's
// reported dances a free account sees in "What's Playing" (already
// ordered most-reported-first, so the cap keeps the most relevant ones).
const VENUE_DANCE_LIMITS: Record<Tier, number> = {
  free: 20,
  sync: Infinity,
  pro: Infinity,
};

export function topDancesPerVenueFor(tier: Tier): number {
  return VENUE_DANCE_LIMITS[tier];
}
