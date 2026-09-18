import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";

WebBrowser.maybeCompleteAuthSession();

// Authorization Code + PKCE needs no client secret at all — the
// code_verifier is what proves this exchange came from the same client
// that started it (that's the whole point of PKCE), so Spotify's PKCE
// token endpoint accepts just the client id, no Authorization header, no
// secret. The client id itself isn't secret (it's meant to travel in the
// app bundle and the authorize URL).
const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? "";

const DISCOVERY = {
  authorizationEndpoint: "https://accounts.spotify.com/authorize",
};

const SCOPES = [
  "playlist-modify-private",
  "playlist-read-private",
];

// Playlist writes/reads only — never request more than this needs.

const NATIVE_REDIRECT = "justonemoredance://spotify-callback";

function base64UrlFromBase64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const randomBytes = await Crypto.getRandomBytesAsync(64);
  const verifier = base64UrlFromBase64(
    btoa(String.fromCharCode(...randomBytes)),
  );
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return { verifier, challenge: base64UrlFromBase64(digest) };
}

export type SpotifyAuthResult =
  | { kind: "success"; code: string; codeVerifier: string; redirectUri: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** Native leg: expo-auth-session's standard AuthRequest/promptAsync, which
 *  uses ASWebAuthenticationSession under the hood via expo-web-browser —
 *  the App-Review-safe mechanism (never a bare WKWebView). */
async function connectNative(): Promise<SpotifyAuthResult> {
  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID,
    scopes: SCOPES,
    redirectUri: NATIVE_REDIRECT,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
  });
  const result = await request.promptAsync(DISCOVERY);
  if (result.type === "success" && request.codeVerifier) {
    return {
      kind: "success",
      code: result.params.code,
      codeVerifier: request.codeVerifier,
      redirectUri: NATIVE_REDIRECT,
    };
  }
  if (result.type === "cancel" || result.type === "dismiss") {
    return { kind: "cancelled" };
  }
  return { kind: "error", message: "Spotify sign-in failed." };
}

const VERIFIER_KEY = "jomd.spotify.pkce_verifier";
const STATE_KEY = "jomd.spotify.pkce_state";

/** Web leg: hand-rolled PKCE rather than expo-auth-session's web codepath
 *  (its redirect-URI handling is a known pain point, and a full-page
 *  redirect cold-boots the SPA regardless of which library drives it).
 *  Redirects to the app's own root origin with query params — NOT a
 *  dedicated /spotify-callback path, since the Cloudflare Worker serving
 *  this app has no SPA fallback routing and an unmatched path 404s. See
 *  src/lib/authLinks.ts's passwordResetRedirectTo() for the same pattern
 *  used for Supabase's recovery links. */
function startWebConnect(): void {
  makePkcePair().then(({ verifier, challenge }) => {
    const state = Crypto.randomUUID();
    window.sessionStorage.setItem(VERIFIER_KEY, verifier);
    window.sessionStorage.setItem(STATE_KEY, state);

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SCOPES.join(" "),
      state,
    });
    window.location.assign(
      `${DISCOVERY.authorizationEndpoint}?${params.toString()}`,
    );
  });
}

/** Call once on app load (web only) to pick up a Spotify redirect that
 *  just landed on the root URL. Returns null for an ordinary page load. */
export function consumeWebSpotifyCallback(): SpotifyAuthResult | null {
  if (Platform.OS !== "web") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code") && !params.has("error")) return null;

  const verifier = window.sessionStorage.getItem(VERIFIER_KEY) ?? "";
  const expectedState = window.sessionStorage.getItem(STATE_KEY);
  window.sessionStorage.removeItem(VERIFIER_KEY);
  window.sessionStorage.removeItem(STATE_KEY);

  // Strip the query string so a refresh doesn't replay a spent code.
  window.history.replaceState(
    null,
    "",
    `${window.location.origin}${window.location.pathname}`,
  );

  const error = params.get("error");
  if (error) return { kind: "error", message: error };

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !verifier || state !== expectedState) {
    return { kind: "error", message: "That Spotify link has expired — try connecting again." };
  }
  // Same computation as startWebConnect() used to build the original
  // redirect_uri — the token exchange requires an exact match, and this is
  // still the same origin+pathname now that the query string is stripped.
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  return { kind: "success", code, codeVerifier: verifier, redirectUri };
}

/** Kicks off the Spotify connect flow. Native resolves directly with the
 *  result; web navigates away (full-page redirect) and never resolves —
 *  the result instead arrives via consumeWebSpotifyCallback() on the next
 *  page load. */
export function connectSpotify(): Promise<SpotifyAuthResult> {
  if (Platform.OS === "web") {
    startWebConnect();
    return new Promise(() => {}); // navigation interrupts this — never resolves
  }
  return connectNative();
}
