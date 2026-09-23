import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";

WebBrowser.maybeCompleteAuthSession();

// Same Authorization Code + PKCE shape as spotifyAuth.ts, with two real
// differences confirmed against Google's current native-app OAuth docs
// before writing this (not assumed — Spotify's model doesn't transfer
// directly):
//
// 1. Google requires TWO separate OAuth clients, one per platform — an
//    "iOS" type client (native) and a "Web application" type client
//    (web). Both are still public/PKCE — "The client_secret is not
//    applicable to requests from clients registered as Android, iOS, or
//    Chrome applications" per Google's docs — but the Web application
//    client may expect one server-side at token-exchange time, which is
//    why `platform` is threaded through to the edge function below: it
//    picks the right secret (or none) server-side, never client-side.
// 2. Google only issues a refresh_token on the FIRST consent grant per
//    account unless prompt=consent forces a fresh one every time — so
//    access_type=offline + prompt=consent are on every authorize request,
//    not just the first, or a disconnect->reconnect cycle would silently
//    stop getting a refresh token on the second connect.
const CLIENT_ID_NATIVE = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_NATIVE ?? "";
const CLIENT_ID_WEB = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? "";

const DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
};

// openid is required to get an id_token back at all — Google's userinfo
// endpoint flatly 401s a token that only carries an unrelated scope like
// youtube (unlike Spotify's /me, which just works off any valid token
// regardless of which scopes it was granted). openid alone (no
// email/profile) is the minimal addition that unlocks this — the edge
// function decodes the id_token's `sub` claim rather than calling
// userinfo as a second request.
const SCOPES = ["openid", "https://www.googleapis.com/auth/youtube"];

// Google's documented format for an iOS-type client's custom-scheme
// redirect is a reverse-DNS scheme matching the bundle id
// ("com.example.app:redirect_uri_path"), NOT an arbitrary scheme like
// Spotify's justonemoredance://spotify-callback — the bundle id
// (com.justonemoredance.app) needed registering as a second URL scheme in
// app.json for this to resolve. Out-of-band (urn:ietf:wg:oauth:2.0:oob)
// is fully deprecated by Google — not an option here.
const NATIVE_REDIRECT = "com.justonemoredance.app:/oauth2redirect";

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

export type GoogleAuthResult =
  | {
      kind: "success";
      code: string;
      codeVerifier: string;
      redirectUri: string;
      platform: "native" | "web";
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** Native leg: same expo-auth-session AuthRequest/promptAsync mechanism as
 *  Spotify's (ASWebAuthenticationSession via expo-web-browser — the
 *  App-Review-safe mechanism, never a bare WKWebView). */
async function connectNative(): Promise<GoogleAuthResult> {
  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID_NATIVE,
    scopes: SCOPES,
    redirectUri: NATIVE_REDIRECT,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
    extraParams: { access_type: "offline", prompt: "consent" },
  });
  const result = await request.promptAsync(DISCOVERY);
  if (result.type === "success" && request.codeVerifier) {
    return {
      kind: "success",
      code: result.params.code,
      codeVerifier: request.codeVerifier,
      redirectUri: NATIVE_REDIRECT,
      platform: "native",
    };
  }
  if (result.type === "cancel" || result.type === "dismiss") {
    return { kind: "cancelled" };
  }
  return { kind: "error", message: "Google sign-in failed." };
}

const VERIFIER_KEY = "jomd.google.pkce_verifier";
const STATE_KEY = "jomd.google.pkce_state";

/** Web leg: hand-rolled PKCE, same reasoning as Spotify's web leg. The
 *  redirect_uri carries a fixed `?provider=youtube` marker baked into the
 *  URL Google is registered to redirect back to — needed so a landing page
 *  load can tell this apart from Spotify's own root-URL callback (both
 *  redirect to the same origin+pathname otherwise). See
 *  consumeWebSpotifyCallback's matching guard in spotifyAuth.ts. */
function startWebConnect(): void {
  makePkcePair().then(({ verifier, challenge }) => {
    const state = Crypto.randomUUID();
    window.sessionStorage.setItem(VERIFIER_KEY, verifier);
    window.sessionStorage.setItem(STATE_KEY, state);

    const redirectUri = `${window.location.origin}${window.location.pathname}?provider=youtube`;
    const params = new URLSearchParams({
      client_id: CLIENT_ID_WEB,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    window.location.assign(
      `${DISCOVERY.authorizationEndpoint}?${params.toString()}`,
    );
  });
}

/** Call once on app load (web only) to pick up a Google redirect that just
 *  landed on the root URL. Returns null for an ordinary page load, or for
 *  a landing that isn't this provider's (see the `provider` guard). */
export function consumeWebGoogleCallback(): GoogleAuthResult | null {
  if (Platform.OS !== "web") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("provider") !== "youtube") return null;

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
    return { kind: "error", message: "That Google link has expired — try connecting again." };
  }
  const redirectUri = `${window.location.origin}${window.location.pathname}?provider=youtube`;
  return { kind: "success", code, codeVerifier: verifier, redirectUri, platform: "web" };
}

/** Kicks off the YouTube connect flow. Native resolves directly with the
 *  result; web navigates away (full-page redirect) and never resolves —
 *  the result instead arrives via consumeWebGoogleCallback() on the next
 *  page load. */
export function connectYouTube(): Promise<GoogleAuthResult> {
  if (Platform.OS === "web") {
    startWebConnect();
    return new Promise(() => {}); // navigation interrupts this — never resolves
  }
  return connectNative();
}
