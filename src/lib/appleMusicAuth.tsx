import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { fetchAppleMusicDeveloperToken } from "./appleMusicSync";

// Two completely different SDKs behind one hook, matched to the plan:
//  - native (iOS): @superfan-app/apple-music-auth, a hook-based wrapper
//    around Apple's native MusicKit framework.
//  - web: MusicKit JS, Apple's own JS SDK, loaded lazily via a <script>
//    tag — no native module exists for web (checked: the package has no
//    .web.ts), so this is a from-scratch implementation.
// Both resolve to the same thing a caller needs: a Music User Token.

type MusicKitInstance = {
  authorize: () => Promise<string>;
  isAuthorized: boolean;
  musicUserToken?: string;
};

declare global {
  interface Window {
    MusicKit?: {
      // Resolves with the configured instance — must be awaited before
      // getInstance()/authorize() are safe to call (see connectAppleMusicWeb).
      configure: (config: {
        developerToken: string;
        app: { name: string; build: string };
      }) => Promise<MusicKitInstance>;
      getInstance: () => MusicKitInstance;
    };
  }
}

const MUSICKIT_JS_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

function loadMusicKitJs(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  // MusicKit.configure isn't attached the instant the <script> tag's own
  // load event fires — the script does its own async init afterward and
  // only becomes usable once it dispatches "musickitloaded" on document.
  // Calling configure() right after script.onload hits it mid-init
  // ("MusicKit.configure is not a function").
  if (window.MusicKit?.configure) return Promise.resolve();
  // MusicKit's own bundle picks Buffer vs window.Buffer with
  // `typeof process<"u" && null!==process.versions &&
  // null!==process.versions.node ? Buffer : window.Buffer`. Metro's web
  // `process` shim provides `process` (for process.env compat) but not
  // `process.versions`, so `undefined !== null` reads as true and the
  // next property access throws ("Cannot read properties of undefined
  // (reading 'node')"). Setting `.versions` to `{}` "fixes" that crash but
  // trips the *next* branch instead — `process.versions.node` is then
  // `undefined`, and `undefined !== null` is STILL true, so it picks the
  // bare Node `Buffer` global, which doesn't exist in a browser either
  // ("Buffer is not defined"). The check only takes the correct
  // window.Buffer path when `process.versions` is exactly `null` — a
  // strict `!==` against `null`, not a `!= null` that would also catch
  // undefined — so that's the one value that actually satisfies it.
  const proc = (window as any).process;
  if (proc && proc.versions !== null) proc.versions = null;
  return new Promise((resolve, reject) => {
    document.addEventListener("musickitloaded", () => resolve(), { once: true });
    const existing = document.querySelector(`script[src="${MUSICKIT_JS_SRC}"]`);
    if (existing) return; // already injected — the listener above covers it
    const script = document.createElement("script");
    script.src = MUSICKIT_JS_SRC;
    script.async = true;
    script.onerror = () => reject(new Error("Could not load Apple Music."));
    document.head.appendChild(script);
  });
}

/** null return = the user closed the sign-in prompt without authorizing —
 *  an ordinary, expected outcome, not a failure worth alerting on. Setup
 *  problems before we ever get to the prompt (script failed to load, bad
 *  developer token, configure() itself rejected) still throw — those mean
 *  something's actually broken. */
async function connectAppleMusicWeb(): Promise<string | null> {
  await loadMusicKitJs();
  if (!window.MusicKit) throw new Error("Apple Music isn't available in this browser.");
  const developerToken = await fetchAppleMusicDeveloperToken();
  // configure() is async in MusicKit JS v3 — it resolves with the ready
  // instance. Calling getInstance().authorize() right after a
  // non-awaited configure() races it: works once configure() has quietly
  // finished from an earlier attempt, throws ("Cannot read properties of
  // undefined (reading 'authorize')") on a first, cold call.
  const instance = await window.MusicKit.configure({
    developerToken,
    app: { name: "Just One More Dance", build: "1.0.0" },
  });
  try {
    const musicUserToken = await instance.authorize();
    return musicUserToken || null;
  } catch {
    // MusicKit rejects (rather than resolving empty) when the user closes
    // the prompt without granting access — by this point setup already
    // succeeded, so any rejection here is the user saying no, not a bug.
    return null;
  }
}

// Native's hook-based API (see @superfan-app/apple-music-auth's
// AppleMusicAuthProvider, mounted once near App.tsx's root) needs to be
// imported lazily so this module never touches it on web, where the
// package's native module doesn't exist.
let nativeHook: (() => { requestAndGetToken: () => Promise<string> }) | null =
  null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeHook = require("@superfan-app/apple-music-auth").useAppleMusicAuth;
}

/** One connect() function regardless of platform — resolves with a Music
 *  User Token on success, or null if the user declined/closed the prompt
 *  (an ordinary outcome, not a failure — caller shouldn't alert on it).
 *  Still throws for a genuine setup problem. Caller (ProfileScreen) hands
 *  a non-null token straight to connectAppleMusic() in appleMusicSync.ts. */
export function useAppleMusicConnect(): { connect: () => Promise<string | null> } {
  // Only actually calls the native hook when nativeHook is set (native
  // platforms) — calling a hook conditionally would break the rules of
  // hooks, so this file is only ever imported where that's already
  // guaranteed true per-platform via the branch above.
  const native = nativeHook?.();
  const nativeRef = useRef(native);
  nativeRef.current = native;

  const connect = useCallback(async () => {
    if (Platform.OS === "web") return connectAppleMusicWeb();
    if (!nativeRef.current) {
      throw new Error("Apple Music isn't available on this platform.");
    }
    try {
      return await nativeRef.current.requestAndGetToken();
    } catch (err: any) {
      // @superfan-app/apple-music-auth's AppleMusicAuthError carries a
      // distinct "authorization_denied" type for exactly this — the user
      // saw the system prompt and declined, as opposed to a real failure
      // (authorization_failed / token_error / authorization_error).
      if (err?.type === "authorization_denied") return null;
      throw err;
    }
  }, []);

  return { connect };
}
