# Connect Supabase

1. In Supabase **SQL Editor**, run the complete contents of `schema.sql`.
2. Then run `migration_venues.sql`, `migration_bootstepper.sql`,
   `migration_friend_requests.sql`, `migration_notes_import.sql`, and
   `migration_my_list.sql` (in that order). `migration_friend_requests.sql`
   adds friend *requests*, the `email_exists` helper the sign-in screen uses,
   and fixes up a couple of CHECK constraints from the original schema.
   `migration_notes_import.sql` adds the Apple Notes import queue and a
   `link` column on `user_dance_progress`. `migration_my_list.sql` adds the
   `created_at` column that powers My List's "Date added" sort. All are
   idempotent — safe to re-run.
3. In **Authentication → Providers → Email**, keep Email enabled. For fast local
   testing, you may turn off **Confirm email**; leave it on for production.
4. Set up redirect URLs for password reset — see below.
5. Restart Expo with `npx expo start --clear` so it reads your local `.env`.

The publishable key belongs in `.env`; it is deliberately ignored by Git. Never
place a service-role key in the mobile app.

---

## Password reset: redirect URLs

A reset email sends the user to Supabase, which then bounces them to whatever
`redirectTo` the app asked for — **but only if that URL is on the allow-list**.
Anything not listed silently falls back to the project's Site URL, which is the
usual reason a reset link "goes to the wrong place".

In **Authentication → URL Configuration → Redirect URLs**, add all of these:

```
http://localhost:8081/**          # expo start --web
http://localhost:19006/**         # older Expo web port, if you use it
https://<your-app>.expo.app/**    # the hosted web build
justonemoredance://**             # iOS/Android standalone + dev client
exp://**                          # Expo Go (its URL includes a LAN IP/port)
```

`src/lib/authLinks.ts` computes the right one at runtime: on web it's the page
the user is currently on, on native it's `Linking.createURL("reset-password")`.

## Testing the reset flow

**Web (local).** `npm run web`, then on the sign-in screen enter your email and
tap *Forgot my password*. Open the emailed link **in the same browser**; it
lands back on `http://localhost:8081/#access_token=…&type=recovery`, supabase-js
picks the tokens out of the URL (`detectSessionInUrl` is on for web only), fires
`PASSWORD_RECOVERY`, and the app shows the reset screen. The fragment is wiped
from the address bar afterwards so a refresh can't replay a spent token.

**Web (hosted).** Same flow against `https://<your-app>.expo.app` — just make
sure that origin is in the allow-list above. Publish with `npx expo export -p web`
and deploy `dist/`, or `npx eas deploy`.

**iOS.** The custom scheme (`justonemoredance`, set in `app.json`) only exists
in a real build, so use a dev client or a standalone build — `npx expo run:ios`,
then request the reset **from the app on the device/simulator** and open the
email there too. Safari hands `justonemoredance://reset-password#access_token=…`
back to the app, `App.tsx` picks it up via `expo-linking` and exchanges it for a
session by hand (native has no `window.location` for supabase-js to read).

To test in **Expo Go** instead, request the reset from Expo Go — the redirect
becomes `exp://<lan-ip>:8081/--/reset-password`, which needs `exp://**` on the
allow-list.

You can also simulate the deep link without an email:

```sh
xcrun simctl openurl booted \
  "justonemoredance://reset-password#access_token=…&refresh_token=…&type=recovery"
```

**Expired links.** Supabase redirects with `error_description` in the fragment
instead of tokens; both the web and native paths surface that as a readable
message pointing back at the sign-in screen.

## Signing in / signing up

The sign-in screen is one form. On a failed sign-in it asks the database
(`email_exists`) whether that address is registered: if it is, the user gets
"that password doesn't match"; if it isn't, the form grows a **confirm
password** field and the button becomes *Create account*.

That RPC does reveal whether an email is registered — the cost of a
sign-in-or-sign-up-from-one-form flow. If you'd rather not expose it, drop the
function and the screen falls back to its "Create an account instead" link,
which is always available.
