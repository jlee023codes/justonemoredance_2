import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { supabase } from "./supabase";

/**
 * Password-reset links have to come back to three different places —
 * a local `expo start --web` dev server, the hosted web build, and the
 * native iOS app — so the redirect URL is computed at call time rather
 * than hard-coded.
 *
 * Whatever this returns must also be listed in the Supabase dashboard
 * under Authentication → URL Configuration → Redirect URLs, or Supabase
 * silently falls back to the Site URL. See SUPABASE_SETUP.md.
 */
export function passwordResetRedirectTo(): string {
  if (Platform.OS === "web") {
    // Same page the user is already on: http://localhost:8081/ in dev,
    // https://<your-app>.expo.app/ for the hosted build. Query/hash are
    // dropped so Supabase's own hash doesn't land on top of an old one.
    return `${window.location.origin}${window.location.pathname}`;
  }
  // Standalone/dev-client: justonemoredance://reset-password
  // Expo Go:               exp://<lan-ip>:8081/--/reset-password
  return Linking.createURL("reset-password");
}

export type RecoveryLink =
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "code"; code: string }
  | { kind: "error"; message: string };

function paramsFrom(part: string | undefined): URLSearchParams {
  return new URLSearchParams((part ?? "").replace(/^[#?]/, ""));
}

/**
 * Pulls a recovery payload out of a deep link. Supabase's implicit flow
 * puts the session in the URL *fragment*; the PKCE flow puts a `code` in
 * the query string; a dead link comes back as `error_description`. Any of
 * the three can show up depending on project settings, so all three are
 * handled here.
 *
 * Returns null for ordinary links (app icon, share links, etc).
 */
export function parseRecoveryLink(url: string | null): RecoveryLink | null {
  if (!url) return null;
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const query =
    queryIndex >= 0
      ? url.slice(queryIndex, hashIndex >= 0 && hashIndex > queryIndex ? hashIndex : undefined)
      : "";

  const fragment = paramsFrom(hash);
  const search = paramsFrom(query);
  const get = (key: string) => fragment.get(key) ?? search.get(key);

  const error = get("error_description") ?? get("error");
  if (error) return { kind: "error", message: error.replace(/\+/g, " ") };

  const accessToken = get("access_token");
  const refreshToken = get("refresh_token");
  if (accessToken && refreshToken && get("type") === "recovery") {
    return { kind: "tokens", accessToken, refreshToken };
  }

  const code = get("code");
  if (code) return { kind: "code", code };

  return null;
}

/**
 * Turns a parsed recovery link into a real Supabase session, which is
 * what `updateUser({ password })` needs on the reset screen.
 * Throws with a human-readable message on a dead or already-used link.
 */
export async function applyRecoveryLink(link: RecoveryLink): Promise<void> {
  if (link.kind === "error") throw new Error(link.message);

  const { error } =
    link.kind === "tokens"
      ? await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        })
      : await supabase.auth.exchangeCodeForSession(link.code);

  if (error) throw error;
}

/**
 * Strips the recovery fragment off the web URL once it's been consumed,
 * so a refresh (or sharing the URL) doesn't replay a spent token.
 */
export function clearRecoveryLinkFromUrl(): void {
  if (Platform.OS !== "web") return;
  if (!window.location.hash && !window.location.search) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.origin}${window.location.pathname}`,
  );
}
