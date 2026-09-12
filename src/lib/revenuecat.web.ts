import {
  ErrorCode,
  Purchases,
  PurchasesError,
  type CustomerInfo,
  type Package,
} from "@revenuecat/purchases-js";
import { showAlert } from "./alerts";

// Web implementation, backed by RevenueCat's Web Billing SDK
// (@revenuecat/purchases-js) — a separate SDK from react-native-purchases,
// configured with its own "Web Billing" public API key and requiring a
// Stripe account connected in the RevenueCat dashboard. See
// REVENUECAT_SETUP.md for the dashboard-side setup this needs.
//
// Every export mirrors revenuecat.ts's signature so callers never need a
// Platform.OS check of their own.

export const PRO_ENTITLEMENT_ID = "just_one_more_dance_pro";
export const PACKAGE_IDS = {
  monthly: "monthly",
  sixMonth: "six_month",
  yearly: "yearly",
} as const;
export type PlanKey = keyof typeof PACKAGE_IDS;

export type PremiumPlan = {
  key: PlanKey;
  package: Package;
  title: string;
  priceString: string;
};

const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY;

let purchases: Purchases | null = null;

// The web SDK has no addCustomerInfoUpdateListener equivalent — we simulate
// one by re-checking the entitlement after anything that could change it
// (login, purchase, restore/refresh) and pushing the result to subscribers.
const listeners = new Set<(isPro: boolean) => void>();
async function notifyListeners(): Promise<void> {
  const isPro = await checkProEntitlement();
  listeners.forEach((l) => l(isPro));
}

/** Idempotent — safe to call every time you have a userId. Unlike the
 *  native SDK, Web Billing requires an app user id up front, so this is a
 *  no-op until one is known (App.tsx only calls it once signed in). */
export function configurePurchases(appUserId?: string): void {
  if (purchases) return;
  if (!apiKey) {
    console.warn(
      "[revenuecat.web] EXPO_PUBLIC_REVENUECAT_WEB_API_KEY is not set — web Purchases will not work. See REVENUECAT_SETUP.md.",
    );
    return;
  }
  if (!appUserId) return;
  purchases = Purchases.configure({ apiKey, appUserId });
}

/** Ties the RevenueCat Web Billing customer to our own (Supabase) user id. */
export async function loginPurchases(appUserId: string): Promise<void> {
  if (!purchases) {
    configurePurchases(appUserId);
    return;
  }
  try {
    await purchases.changeUser(appUserId);
    void notifyListeners();
  } catch (err) {
    console.warn("[revenuecat.web] changeUser failed", err);
  }
}

/** Call on sign-out so the *next* sign-in (possibly a different account on
 *  a shared device) doesn't inherit this customer's purchase history. */
export async function logoutPurchases(): Promise<void> {
  if (!purchases) return;
  purchases.close();
  purchases = null;
}

/** The one function everything else in the app should call to answer
 *  "is this person a paying (or comped-via-store) subscriber?" */
export async function checkProEntitlement(): Promise<boolean> {
  if (!purchases) return false;
  try {
    return await purchases.isEntitledTo(PRO_ENTITLEMENT_ID);
  } catch (err) {
    console.warn("[revenuecat.web] isEntitledTo failed", err);
    return false;
  }
}

/** Fires immediately with the current state. There's no live push channel
 *  on web, so later changes only surface after something in this module
 *  re-checks (login, purchase, restore) — good enough since a purchase
 *  made on web always goes through one of those. */
export function addEntitlementListener(
  onChange: (isPro: boolean) => void,
): () => void {
  listeners.add(onChange);
  checkProEntitlement().then(onChange);
  return () => listeners.delete(onChange);
}

/** The current offering's packages, matched up to our three named plans by
 *  the package identifiers configured in the dashboard. */
export async function fetchOfferedPlans(): Promise<PremiumPlan[]> {
  if (!purchases) return [];
  try {
    const offerings = await purchases.getOfferings();
    const offering = offerings.current;
    if (!offering) return [];
    const byId = new Map(offering.availablePackages.map((p) => [p.identifier, p]));
    const plans: PremiumPlan[] = [];
    for (const key of Object.keys(PACKAGE_IDS) as PlanKey[]) {
      const pkg = byId.get(PACKAGE_IDS[key]);
      if (!pkg) continue;
      plans.push({
        key,
        package: pkg,
        title: pkg.webBillingProduct.title || pkg.identifier,
        priceString: pkg.webBillingProduct.currentPrice.formattedPrice,
      });
    }
    return plans;
  } catch (err) {
    console.warn("[revenuecat.web] getOfferings failed", err);
    return [];
  }
}

export type PurchaseOutcome =
  | { success: true; customerInfo: CustomerInfo }
  | { success: false; cancelled: boolean; error?: string };

function isUserCancelled(err: unknown): boolean {
  return err instanceof PurchasesError && err.errorCode === ErrorCode.UserCancelledError;
}

export async function purchasePlan(pkg: Package): Promise<PurchaseOutcome> {
  if (!purchases) return { success: false, cancelled: false, error: "Not configured." };
  try {
    const { customerInfo } = await purchases.purchase({ rcPackage: pkg });
    void notifyListeners();
    return { success: true, customerInfo };
  } catch (err) {
    if (isUserCancelled(err)) return { success: false, cancelled: true };
    return {
      success: false,
      cancelled: false,
      error: err instanceof Error ? err.message : "Purchase failed.",
    };
  }
}

/** Web Billing purchases are tied to the signed-in account, not a device —
 *  there's nothing to "restore" the way App Store/Play Store do. This just
 *  refreshes and reports the current entitlement instead. */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  if (!purchases) return { success: false, cancelled: false, error: "Not configured." };
  try {
    const customerInfo = await purchases.getCustomerInfo();
    void notifyListeners();
    if (customerInfo.entitlements.active[PRO_ENTITLEMENT_ID]) {
      return { success: true, customerInfo };
    }
    return {
      success: false,
      cancelled: false,
      error:
        "No active subscription found for this account on the web. If you subscribed on iOS or Android, sign in there to manage it.",
    };
  } catch (err) {
    return {
      success: false,
      cancelled: false,
      error: err instanceof Error ? err.message : "Could not check your subscription.",
    };
  }
}

export type PaywallOutcome = "purchased" | "restored" | "cancelled" | "error" | "not_presented";

/** Shows RevenueCat's dashboard-configured paywall as a full-screen
 *  overlay. The SDK's own returned promise only documents the
 *  successful-purchase case, so cancellation/error are also caught via the
 *  paywall's listener callbacks — whichever settles first wins. */
export async function presentPaywall(): Promise<PaywallOutcome> {
  if (!purchases) return "error";
  return new Promise<PaywallOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: PaywallOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    purchases!
      .presentPaywall({
        listener: {
          onPurchaseCancelled: () => finish("cancelled"),
          onPurchaseError: () => finish("error"),
        },
      })
      .then(() => {
        void notifyListeners();
        finish("purchased");
      })
      .catch((err) => {
        if (isUserCancelled(err)) {
          finish("cancelled");
        } else {
          console.warn("[revenuecat.web] presentPaywall failed", err);
          finish("error");
        }
      });
  });
}

export async function presentPaywallIfNeeded(): Promise<PaywallOutcome> {
  if (!purchases) return "error";
  if (await checkProEntitlement()) return "not_presented";
  return presentPaywall();
}

/** Opens RevenueCat's hosted subscription management page (backed by
 *  Stripe's billing portal) in a new tab, where the customer can cancel,
 *  change plan, or update payment info themselves — the web equivalent of
 *  native's Customer Center. `managementURL` is null if they have no
 *  active web subscription (e.g. a comped user, or a subscriber on a
 *  different platform). */
export async function presentCustomerCenter(): Promise<void> {
  if (!purchases) {
    showAlert("Not available", "Sign in first to manage your subscription.");
    return;
  }
  try {
    const info = await purchases.getCustomerInfo();
    if (info.managementURL) {
      window.open(info.managementURL, "_blank", "noopener,noreferrer");
    } else {
      showAlert(
        "Nothing to manage",
        "You don't have an active web subscription. If you subscribed on iOS or Android, manage it from that app instead.",
      );
    }
  } catch (err) {
    console.warn("[revenuecat.web] presentCustomerCenter failed", err);
  }
}
