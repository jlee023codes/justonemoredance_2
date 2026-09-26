import { Platform } from "react-native";
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PurchasesOffering,
  PurchasesPackage,
} from "react-native-purchases";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import { Tier } from "./tier";

// Native (iOS/Android) implementation. See revenuecat.web.ts for the web
// stub with the same exported surface — react-native-purchases has no web
// support, so nothing in this file may run there.
//
// Requires a development build (Expo Go can't load native modules) — see
// REVENUECAT_SETUP.md.

// Three tiers, three entitlement identifiers — each tier's product in
// RevenueCat is attached to every entitlement at or below its own level
// (Grapevine → sync; Line Up → sync + friends; Floor Boss/"pro" → all
// three), so tierFor() below just needs to check from the top down.
export const SYNC_ENTITLEMENT_ID = "grapevine";
export const FRIENDS_ENTITLEMENT_ID = "line-up";
export const PRO_ENTITLEMENT_ID = "just_one_more_dance_pro";

// The package identifiers as configured on the Offering in the RevenueCat
// dashboard (Products & Offerings → your offering → Packages). These are
// custom identifiers, not RevenueCat's `$rc_*` built-ins.
export const PACKAGE_IDS = {
  monthly: "monthly",
  sixMonth: "six_month",
  yearly: "yearly",
} as const;
export type PlanKey = keyof typeof PACKAGE_IDS;

export type PremiumPlan = {
  key: PlanKey;
  package: PurchasesPackage;
  title: string;
  priceString: string;
};

const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

let configured = false;

/** Idempotent — safe to call every time you have a userId (e.g. on every
 *  sign-in), including before you know it (pass nothing to configure
 *  anonymously, then call loginPurchases once you do). */
export function configurePurchases(appUserId?: string): void {
  if (configured) return;
  if (!apiKey) {
    console.warn(
      "[revenuecat] EXPO_PUBLIC_REVENUECAT_API_KEY is not set — Purchases will not work. See REVENUECAT_SETUP.md.",
    );
    return;
  }
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey, appUserID: appUserId });
  configured = true;
}

/** Ties the RevenueCat customer to our own (Supabase) user id — call once
 *  you know who's signed in, so purchases/entitlements follow the account
 *  across devices/reinstalls rather than staying tied to an anonymous id. */
export async function loginPurchases(appUserId: string): Promise<void> {
  if (!configured) return configurePurchases(appUserId);
  try {
    await Purchases.logIn(appUserId);
  } catch (err) {
    console.warn("[revenuecat] logIn failed", err);
  }
}

/** Call on sign-out so the *next* sign-in (possibly a different account on
 *  a shared device) doesn't inherit this customer's purchase history. */
export async function logoutPurchases(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    console.warn("[revenuecat] logOut failed", err);
  }
}

function tierFor(info: CustomerInfo): Tier {
  const active = info.entitlements.active;
  if (active[PRO_ENTITLEMENT_ID]) return "pro";
  if (active[FRIENDS_ENTITLEMENT_ID]) return "friends";
  if (active[SYNC_ENTITLEMENT_ID]) return "sync";
  return "free";
}

/** The one function everything else in the app should call to answer
 *  "what tier is this person paying (or comped-via-store) for?" */
export async function checkTier(): Promise<Tier> {
  if (!configured) return "free";
  try {
    const info = await Purchases.getCustomerInfo();
    return tierFor(info);
  } catch (err) {
    console.warn("[revenuecat] getCustomerInfo failed", err);
    return "free";
  }
}

/** Fires immediately with the current state, then again on every future
 *  change (purchase, renewal, cancellation, refund, restore — anywhere,
 *  not just from this session). Returns an unsubscribe function. */
export function addEntitlementListener(
  onChange: (tier: Tier) => void,
): () => void {
  if (!configured) return () => {};
  const listener = (info: CustomerInfo) => onChange(tierFor(info));
  Purchases.addCustomerInfoUpdateListener(listener);
  checkTier().then(onChange);
  return () => Purchases.removeCustomerInfoUpdateListener(listener);
}

/** The current offering's packages, matched up to our three named plans by
 *  the package identifiers configured in the dashboard. Only plans that
 *  actually exist on the offering are returned (so a half-configured
 *  Offering degrades gracefully instead of crashing). */
export async function fetchOfferedPlans(): Promise<PremiumPlan[]> {
  if (!configured) return [];
  try {
    const offerings = await Purchases.getOfferings();
    const offering: PurchasesOffering | null = offerings.current;
    if (!offering) return [];
    const byId = new Map(offering.availablePackages.map((p) => [p.identifier, p]));
    const plans: PremiumPlan[] = [];
    for (const key of Object.keys(PACKAGE_IDS) as PlanKey[]) {
      const pkg = byId.get(PACKAGE_IDS[key]);
      if (!pkg) continue;
      plans.push({
        key,
        package: pkg,
        title: pkg.product.title || pkg.identifier,
        priceString: pkg.product.priceString,
      });
    }
    return plans;
  } catch (err) {
    console.warn("[revenuecat] getOfferings failed", err);
    return [];
  }
}

export type PurchaseOutcome =
  | { success: true; customerInfo: CustomerInfo }
  | { success: false; cancelled: boolean; error?: string };

export async function purchasePlan(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { success: true, customerInfo };
  } catch (err: any) {
    return {
      success: false,
      cancelled: Boolean(err?.userCancelled),
      error: err?.userCancelled ? undefined : err?.message ?? "Purchase failed.",
    };
  }
}

export async function restorePurchases(): Promise<PurchaseOutcome> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return { success: true, customerInfo };
  } catch (err: any) {
    return { success: false, cancelled: false, error: err?.message ?? "Restore failed." };
  }
}

export type PaywallOutcome = "purchased" | "restored" | "cancelled" | "error" | "not_presented";

function mapPaywallResult(result: PAYWALL_RESULT): PaywallOutcome {
  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
      return "purchased";
    case PAYWALL_RESULT.RESTORED:
      return "restored";
    case PAYWALL_RESULT.CANCELLED:
      return "cancelled";
    case PAYWALL_RESULT.NOT_PRESENTED:
      return "not_presented";
    default:
      return "error";
  }
}

/** Shows RevenueCat's dashboard-configured paywall for the current
 *  offering. Prefer `presentPaywallIfNeeded` when gating a specific
 *  screen — it no-ops if the user already has the entitlement. */
export async function presentPaywall(): Promise<PaywallOutcome> {
  if (!configured) return "error";
  try {
    return mapPaywallResult(await RevenueCatUI.presentPaywall());
  } catch (err) {
    console.warn("[revenuecat] presentPaywall failed", err);
    return "error";
  }
}

export async function presentPaywallIfNeeded(
  requiredEntitlementIdentifier: string = PRO_ENTITLEMENT_ID,
): Promise<PaywallOutcome> {
  if (!configured) return "error";
  try {
    return mapPaywallResult(
      await RevenueCatUI.presentPaywallIfNeeded({ requiredEntitlementIdentifier }),
    );
  } catch (err) {
    console.warn("[revenuecat] presentPaywallIfNeeded failed", err);
    return "error";
  }
}

/** Apple's native "redeem code" sheet, for Offer Codes generated in App
 *  Store Connect (Subscriptions → your plan → Offer Codes) — the iOS
 *  equivalent of a promo/discount code, since StoreKit has no text-field
 *  mechanism like Web Billing's `showDiscountCodeField`. iOS-only; a no-op
 *  on Android. A successful redemption grants the entitlement directly
 *  through StoreKit and surfaces via the existing customer-info listener,
 *  same as any other purchase — nothing further to handle here. */
export async function redeemOfferCode(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    await Purchases.presentCodeRedemptionSheet();
  } catch (err) {
    console.warn("[revenuecat] presentCodeRedemptionSheet failed", err);
  }
}

/** RevenueCat's self-service subscription management UI (cancel, change
 *  plan, request a refund, contact support, restore). */
export async function presentCustomerCenter(): Promise<void> {
  if (!configured) return;
  try {
    await RevenueCatUI.presentCustomerCenter();
  } catch (err) {
    console.warn("[revenuecat] presentCustomerCenter failed", err);
  }
}
