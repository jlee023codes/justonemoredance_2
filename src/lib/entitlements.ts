import { supabase } from "./supabase";
import * as RC from "./revenuecat";

// The app's single notion of "premium": a real RevenueCat entitlement OR a
// manual server-side comp. Everything that needs to know "is this person
// premium" or wants to trigger a purchase/restore/manage flow should go
// through this file, not react-native-purchases directly — that keeps the
// comp mechanism and the real SDK indistinguishable to the rest of the app.

export const PRO_ENTITLEMENT_ID = RC.PRO_ENTITLEMENT_ID;
export const PACKAGE_IDS = RC.PACKAGE_IDS;
export type PlanKey = RC.PlanKey;
export type PremiumPlan = RC.PremiumPlan;
export type PurchaseOutcome = RC.PurchaseOutcome;
export type PaywallOutcome = RC.PaywallOutcome;

// Session lifecycle — call from App.tsx once you know the signed-in
// Supabase user id, and on sign-out.
export const configurePurchases = RC.configurePurchases;
export const loginPurchases = RC.loginPurchases;
export const logoutPurchases = RC.logoutPurchases;

// Buying / managing.
export const fetchOfferedPlans = RC.fetchOfferedPlans;
export const purchasePlan = RC.purchasePlan;
export const restorePurchases = RC.restorePurchases;
export const presentPaywall = RC.presentPaywall;
export const presentPaywallIfNeeded = RC.presentPaywallIfNeeded;
export const presentCustomerCenter = RC.presentCustomerCenter;

/** A manual comp (see migration_premium_venues.sql) — set this directly in
 *  Supabase to give someone Premium for free, ahead of (or instead of) a
 *  real subscription:
 *    update profiles set comped_premium = true where id = '<their user id>';
 *  IMPORTANT: this is a stand-in for what should eventually be a
 *  RevenueCat webhook (Edge Function) flipping this same column on
 *  purchase/renewal/expiration, so venue_dance_reports' "premium users'
 *  tags count" logic also picks up *real* subscribers, not just comped
 *  ones. Right now a real paying customer unlocks the app's screens fine
 *  (that's driven by the live RevenueCat check below) but their own
 *  venue-tagged dances won't count in the shared aggregate until they're
 *  either comped here too or that webhook exists. */
export async function loadPremiumFromServer(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("comped_premium")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.comped_premium === true;
  } catch {
    return false;
  }
}

/** The single source of truth to gate the UI on: a real RevenueCat
 *  entitlement OR the manual server comp, OR'd together. Calls `onChange`
 *  once immediately with the current answer and again on every future
 *  RevenueCat entitlement change (purchase, renewal, cancellation, refund,
 *  restore — from any session, not just this one). Returns an unsubscribe
 *  function; the server comp isn't re-polled after that (it only ever
 *  changes from outside the app, e.g. you running a SQL update — call this
 *  again, such as on next sign-in, to pick that up). */
export function subscribeToPremiumStatus(
  userId: string,
  onChange: (isPremium: boolean) => void,
): () => void {
  let serverFlag = false;
  let rcFlag = false;
  let cancelled = false;
  const publish = () => {
    if (!cancelled) onChange(rcFlag || serverFlag);
  };

  loadPremiumFromServer(userId).then((v) => {
    serverFlag = v;
    publish();
  });
  const unsubscribeRC = RC.addEntitlementListener((v) => {
    rcFlag = v;
    publish();
  });

  return () => {
    cancelled = true;
    unsubscribeRC();
  };
}
