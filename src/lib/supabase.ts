import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error("Missing Supabase configuration. Copy .env.example to .env.");

// On web, a password-reset link lands back on the app with the session in
// the URL fragment, and only supabase-js can turn that into a session —
// so `detectSessionInUrl` has to be on there. On native there's no URL to
// read; App.tsx picks the deep link up through expo-linking instead (see
// src/lib/authLinks.ts).
const isWeb = Platform.OS === "web";

export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isWeb,
    // Implicit, not PKCE, on purpose: the reset email is often opened on a
    // different device than the one that requested it, and PKCE's code
    // verifier only exists in the requesting browser's storage.
    flowType: "implicit",
  },
});

// On the web, supabase-js refreshes the access token on its own (it watches
// page visibility). On native it does NOT — you have to drive the refresh
// loop from AppState, or the token silently expires after ~1h and every
// authenticated call (RLS reads, the BootStepper proxy) starts failing with
// "Not authenticated" until something calls getSession() by hand.
if (!isWeb) {
  supabase.auth.startAutoRefresh();
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
