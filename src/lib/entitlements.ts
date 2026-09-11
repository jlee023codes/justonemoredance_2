import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

// Placeholder for RevenueCat. The Friends tab (and its "add friends" /
// friend-list-import features), plus the Venues tab, are meant to be a
// premium subscription perk, but no subscription product exists yet —
// RevenueCat needs an account, App Store / Play Store product setup, and
// an entitlement id, none of which this environment can create or test.
//
// Every premium check in the app goes through `loadIsPremium` /
// `setDevPremiumOverride` so wiring up the real SDK later is a one-file
// change: swap the body of `loadIsPremium` for something like
//   const info = await Purchases.getCustomerInfo();
//   return Boolean(info.entitlements.active["premium"]);
// and keep the same boolean contract. Until then, entitlement is just a
// local dev override — flip it from Profile → Settings to preview the
// premium UI. Remove that toggle once real purchases are wired up.
const DEV_OVERRIDE_KEY = "jomd.dev-premium-override";

export async function loadIsPremium(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DEV_OVERRIDE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setDevPremiumOverride(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(DEV_OVERRIDE_KEY, on ? "1" : "0");
  } catch {
    // non-critical — worst case the toggle doesn't stick across reloads
  }
}

// Mirrors the local flag onto profiles.is_premium so DB-side logic (the
// venue_dance_reports view only counts a premium user's tagged dances —
// see migration_premium_venues.sql) has something to key off.
//
// IMPORTANT: this is the client asserting its own entitlement, which is
// only acceptable because there's no real money or server-verified
// subscription behind it yet. Once RevenueCat is wired up, this write
// must move server-side (a webhook handler reacting to RevenueCat events)
// — never let the app itself flip its own is_premium in production.
export async function syncPremiumStatus(
  userId: string,
  isPremium: boolean,
): Promise<void> {
  try {
    await supabase
      .from("profiles")
      .update({ is_premium: isPremium })
      .eq("id", userId);
  } catch {
    // non-critical — the local flag still gates the UI either way; only
    // the shared "venue songs" aggregate depends on this having landed.
  }
}
