# RevenueCat setup

The app is fully wired for RevenueCat on **both native and web**:
`src/lib/revenuecat.ts` (iOS/Android, via `react-native-purchases` +
`react-native-purchases-ui`) and `src/lib/revenuecat.web.ts` (web, via
`@revenuecat/purchases-js`, RevenueCat's **Web Billing** SDK) — both used
through the platform-agnostic `src/lib/entitlements.ts`. What's left is
dashboard-side configuration (different for each platform — see below) and,
for native, a rebuild (native modules can't load in Expo Go).

## 1. Dashboard: entitlement, products, offering, paywall

In your [RevenueCat dashboard](https://app.revenuecat.com/):

1. **Entitlement** — create one with identifier **`just_one_more_dance_pro`**
   (must match exactly; it's hardcoded in `src/lib/revenuecat.ts`).
2. **Products** — in App Store Connect / Google Play Console, create the
   underlying subscription products (however you want to name/price them),
   then import them into RevenueCat and attach each to the
   `just_one_more_dance_pro` entitlement.

   **Pricing** (same for the App Store/Play products here and the Web
   Billing products in section 1b — one description, three terms):
   - Monthly — **$4.99**
   - 6-month — **$24.99** (~$4.17/mo, ~17% off monthly)
   - Yearly — **$39.99** (~$3.33/mo, ~33% off monthly)

   Paywall description (same across all three packages — only price/term
   differ): *"Unlock Venues and Friends: browse the full venue catalog and
   see what's popular there, set a pinned home bar, connect with friends to
   see their activity and plan nights out together, and import their
   dances into your own list."*
3. **Offering + Packages** — create an Offering (e.g. `default`, marked
   "current") with three packages using these **exact** identifiers (also
   hardcoded, in `PACKAGE_IDS`):
   - `monthly`
   - `six_month`
   - `yearly`

   Each package wraps one of the store products from step 2.
4. **Paywall** — on that Offering, use RevenueCat's paywall builder to
   design one (Tools → Paywalls). `presentPaywall()` /
   `presentPaywallIfNeeded()` show whatever's attached to the *current*
   offering — no app code changes needed when you redesign it later.
5. **API key** — Project settings → API keys → the public SDK key (safe to
   ship client-side). Already in `.env` as `EXPO_PUBLIC_REVENUECAT_API_KEY`
   for local dev; set the same var wherever you build for real (EAS
   secrets, CI, etc.). If you split iOS/Android into separate RevenueCat
   apps later, `configurePurchases` in `src/lib/revenuecat.ts` is the one
   place to branch by `Platform.OS`.

## 1b. Dashboard: Web Billing (for the paywall to work on `npm run web`)

Native purchases (App Store / Play) and web purchases are handled by two
separate RevenueCat "apps" inside the same project, so this is additional
setup, not a replacement for section 1:

1. **Connect Stripe** — RevenueCat dashboard → Project settings →
   Integrations → **Web Billing**, connect (or create) a Stripe account.
   This is required; Web Billing checkout runs through Stripe.
2. **Web Billing app + products** — still in Web Billing settings, add a
   Web Billing app if you don't have one, then create products there
   (these are separate from the App Store/Play products in step 1 — Web
   Billing doesn't reuse them) and attach each to the same
   `just_one_more_dance_pro` entitlement.
3. **Packages** — add this app's products to the **same Offering** used in
   section 1, under the same three package identifiers (`monthly`,
   `six_month`, `yearly`). One Offering can mix store products and Web
   Billing products — the app picks whichever platform it's running on.
4. **API key** — Project settings → API keys → the **Web Billing** public
   key (this is a *different* key from the one in step 1.5, not
   interchangeable). Put it in `.env` as
   `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY`.
5. Restart the web dev server after editing `.env`
   (`npx expo start --web --clear`) so it picks up the new var.

Sandbox/test purchases on web: RevenueCat's Web Billing sandbox mode uses
Stripe test cards — no separate tester account needed like App
Store/Play.

## 2. Rebuild — required for native, Expo Go won't work

`react-native-purchases` is a native module. This project already has a
committed `ios/` project (from an earlier prebuild), so:

```sh
npx pod-install          # link the new native module into ios/
npx expo run:ios         # or open ios/JustOneMoreDance.xcworkspace in Xcode
```

There's no `android/` directory yet (it's gitignored / not generated) —
`npx expo run:android` will generate and build it.

For TestFlight/Play builds use EAS as usual (`eas build`); make sure
`EXPO_PUBLIC_REVENUECAT_API_KEY` is set as an EAS secret/env var for those
build profiles too.

Sandbox/test purchases: use a **StoreKit sandbox tester** account (iOS) or
a **license tester** (Android) — real payment methods aren't charged, but
you still need a device/simulator dev build, not Expo Go.

## 3. What's already built

- **`src/lib/revenuecat.ts`** (native, `react-native-purchases` +
  `react-native-purchases-ui`) / **`revenuecat.web.ts`** (web,
  `@revenuecat/purchases-js`) — Metro picks whichever matches the build
  target automatically, and both export the same functions so the rest of
  the app never branches on platform. Wraps configure/login/logout,
  entitlement checks + live updates, fetching the current offering's
  packages, purchasing, restoring, and presenting the Paywall / Customer
  Center.
  - On web there's no push-based entitlement listener like native has, so
    `addEntitlementListener` re-checks after anything that could change
    status (login, purchase, restore) instead of a true live subscription.
  - On web, "restore" doesn't really apply (Web Billing purchases are tied
    to the signed-in account, not a device) — `restorePurchases()` just
    refreshes and reports the current entitlement.
  - On web, `presentCustomerCenter()` opens the customer's
    `managementURL` (a hosted Stripe billing-portal page RevenueCat
    provisions automatically) in a new tab, where they can cancel, change
    plan, or update payment info — the web equivalent of native's
    Customer Center. It's `null` for comped users or subscribers on a
    different platform.
- **`src/lib/entitlements.ts`** — the app's single "is this person
  premium" answer: a real RevenueCat entitlement **or** a manual comp
  (`profiles.comped_premium`, see below). `App.tsx` configures RevenueCat and
  logs in with the Supabase user id as soon as someone signs in, logs out
  on sign-out, and subscribes to live entitlement changes.
- **Venues and Friends tabs** gate on `isPremium`; not-entitled users see
  `PaywallScreen`, whose "Upgrade" button calls `presentPaywall()`.
- **Profile → Settings**: "Manage subscription" (Customer Center) and
  "Restore purchases".

## 4. Known gap: the manual comp column isn't synced to real purchases

`profiles.comped_premium` (added in `migration_premium_venues.sql` as
`is_premium`, renamed by `migration_comped_premium_rename.sql`) is what
lets you comp specific people by id without a real subscription — see the
`update profiles set comped_premium = true where id = '...'` pattern used
earlier. It also gates `venue_dance_reports` (only a "premium" user's
venue-tagged dances count in the shared aggregate).

**A real, paying RevenueCat subscriber unlocks the app's screens correctly**
(that's driven by the live entitlement check, independent of this column)
— but their `profiles.comped_premium` stays `false` unless you comp them
too, so their own tagged dances won't count toward `venue_dance_reports`
until either that happens or you build a RevenueCat **webhook**: a
Supabase Edge Function that RevenueCat calls on `INITIAL_PURCHASE` /
`RENEWAL` / `EXPIRATION` / `CANCELLATION` events, writing
`profiles.comped_premium` accordingly (RevenueCat dashboard →
Integrations → Webhooks, with the Supabase user id passed as the
RevenueCat `app_user_id` since that's what `loginPurchases(userId)` sets
it to). That's the natural next step once real subscriptions are flowing
— happy to build it when you're ready.
