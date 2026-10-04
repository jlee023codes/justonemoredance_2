// Shared, platform-agnostic tier model — imported by both revenuecat.ts
// and revenuecat.web.ts (which is why it lives in its own file rather
// than entitlements.ts, which imports from both of those and would
// create a circular import otherwise).
//
// Two paid tiers: Grapevine (100+ dance tracking, Apple Music/YouTube
// sync) and Floor Boss (everything in Grapevine, plus unlimited dance
// tracking and Friends). Floor Boss's RevenueCat product must carry
// BOTH the grapevine (sync) entitlement and its own pro entitlement —
// see REVENUECAT_SETUP.md — so a single tierAtLeast() check is correct
// with no extra OR logic needed here: checking for "sync" is true for
// anyone on Grapevine or Floor Boss.
export type Tier = "free" | "sync" | "pro";

const TIER_RANK: Record<Tier, number> = { free: 0, sync: 1, pro: 2 };

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

/** The higher of two tiers — used to combine RevenueCat's reported tier
 *  with a manual server comp (see entitlements.ts). */
export function maxTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  sync: "Grapevine",
  pro: "Floor Boss",
};
