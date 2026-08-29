# Just One More Dance

An Expo/React Native starter for iOS and Android. It has venue-aware song display, dance search, Want-to-learn and Learned lists, friend suggestions, and milestone feedback.

## Run locally in VS Code

1. Open this folder in VS Code.
2. In its terminal, run `npm install`.
3. Run `npx expo start` (or `npm start`).
4. Install **Expo Go** on an iPhone or Android device and scan the QR code; press `i` for an iOS simulator or `a` for Android emulator.

The first version uses in-memory sample data, so restarting clears progress. This makes the interaction easy to test before connecting a backend.

## Free test database: Supabase

1. Create a free project at [Supabase](https://supabase.com/).
2. In the project's **SQL Editor**, paste and run `supabase/schema.sql`.
3. Add Supabase authentication and the `@supabase/supabase-js` package when you are ready to persist each person's list.

The schema separates the canonical dance catalog (`dances`) from venue-specific songs and swaps. `user_dance_progress` stores a person's status and whether it came from a friend. On share: upsert an overlap's new swap in `song_swaps`; insert non-overlaps in the recipient's `user_dance_progress` with `source = 'friend'` and `status = 'want'`.

## Before publishing

Replace the iOS bundle identifier and Android package in `app.json` with identifiers you own. For app-store builds, install EAS CLI and run `npx eas build:configure`, then `npx eas build --platform all`.
