// Shared, platform-agnostic tier model — imported by both revenuecat.ts
// and revenuecat.web.ts (which is why it lives in its own file rather
// than entitlements.ts, which imports from both of those and would
// create a circular import otherwise).
//
// Each tier's RevenueCat product is attached to every entitlement at or
// below its own level (Line Up's product carries both "sync" and
// "friends"; Floor Boss's carries all three) — see
// REVENUECAT_SETUP.md / the App Store Connect subscription group for the
// actual product-to-entitlement wiring. That stacking is what makes a
// single tierAtLeast() check correct: checking for "sync" is true for
// anyone on Grapevine, Line Up, or Floor Boss, with no extra OR logic
// needed here.
export type Tier = "free" | "sync" | "friends" | "pro";

const TIER_RANK: Record<Tier, number> = { free: 0, sync: 1, friends: 2, pro: 3 };

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
  friends: "Line Up",
  pro: "Floor Boss",
};
