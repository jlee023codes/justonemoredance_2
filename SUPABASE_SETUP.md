# Connect Supabase

1. In Supabase **SQL Editor**, run the complete contents of `supabase/schema.sql`.
2. In **Authentication → Providers → Email**, keep Email enabled. For fast local testing, you may turn off **Confirm email**; leave it on for production.
3. Restart Expo with `npx expo start --clear` so it reads your local `.env`.
4. Create an account in the app, then mark a dance Want to learn or Learned. Reloading the app will now restore that progress.

The publishable key belongs in `.env`; it is deliberately ignored by Git. Never place a service-role key in the mobile app.
