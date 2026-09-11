# Just One More Dance

An Expo / React Native app (iOS + web) for tracking line dances: search the
[BootStepper](https://api.bootstepper.com) catalog, keep everything you're
learning in one **My List** (search it, quick-filter by Want to Learn /
Learning Now / Learned, filter by venue / difficulty / counts / walls / tags /
video, and sort any way you like), tag dances to the venues you dance them at
(managed from **Profile → My Venues**), browse a **Venues** page of every
venue in the shared catalog to see which dances people report dancing there,
and — as a premium feature — add friends, see their activity, and plan
nights out on the **Friends** tab (make an event, everyone RSVPs). Also:
bulk-import a checklist pasted from Apple Notes, jot dances into an
on-device **offline notepad** when you lose signal (import them once you're
back online), and unlock milestones.

Premium isn't wired up to a real store yet — see
[src/lib/entitlements.ts](src/lib/entitlements.ts) and the "Dev: preview
Premium" toggle in Profile → Settings.

## Run locally

```sh
npm install
npx expo start        # then press i for iOS, w for web
npx expo start --web  # web only
```

You need a Supabase project connected first — see below.

## Supabase

1. Create a free project at [supabase.com](https://supabase.com/).
2. Copy `.env.example` to `.env` and fill in your project URL + publishable key.
3. Run the SQL in `schema.sql`, then `migration_venues.sql`,
   `migration_bootstepper.sql`, `migration_friend_requests.sql`,
   `migration_notes_import.sql`, `migration_my_list.sql`,
   `migration_venue_dedup.sql`, `migration_venues_page.sql`,
   `migration_learning_status.sql`, `migration_friends_page.sql`, and
   `migration_premium_venues.sql`.
4. Deploy the BootStepper proxy and set its key:
   ```sh
   supabase functions deploy bootstepper-proxy
   supabase secrets set BOOTSTEPPER_API_KEY=your-key
   ```

Full details, including the password-reset redirect URLs, are in
[SUPABASE_SETUP.md](SUPABASE_SETUP.md).

The dance catalog lives in BootStepper, not the database — the app only ever
reaches it through the `bootstepper-proxy` Edge Function so the API key never
ships in the client. Supabase stores each user's profile, progress, venues,
song swaps, and friendships.

## Scripts

| command | what |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run web` | Expo dev server, web only |
| `npm run ios` | build + run the native iOS app |
| `npm run typecheck` | `tsc --noEmit` |

## Deploy the web build

```sh
npx expo export --platform web   # writes dist/
npx eas deploy --prod            # https://<name>.expo.app
```

## Before an app-store build

Replace the iOS bundle identifier / Android package in `app.json` with ones you
own, then `npx eas build --platform all`.
