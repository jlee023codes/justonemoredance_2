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

declare global {
  interface Window {
    MusicKit?: {
      configure: (config: {
        developerToken: string;
        app: { name: string; build: string };
      }) => any;
      getInstance: () => {
        authorize: () => Promise<string>;
        isAuthorized: boolean;
        musicUserToken?: string;
      };
    };
  }
}

const MUSICKIT_JS_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

function loadMusicKitJs(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.MusicKit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MUSICKIT_JS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.src = MUSICKIT_JS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Apple Music."));
    document.head.appendChild(script);
  });
}

async function connectAppleMusicWeb(): Promise<string> {
  await loadMusicKitJs();
  if (!window.MusicKit) throw new Error("Apple Music isn't available in this browser.");
  const developerToken = await fetchAppleMusicDeveloperToken();
  window.MusicKit.configure({
    developerToken,
    app: { name: "Just One More Dance", build: "1.0.0" },
  });
  const musicUserToken = await window.MusicKit.getInstance().authorize();
  if (!musicUserToken) throw new Error("Apple Music sign-in was cancelled.");
  return musicUserToken;
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
 *  User Token on success, throws on cancel/failure. Caller (ProfileScreen)
 *  hands the token straight to connectAppleMusic() in appleMusicSync.ts. */
export function useAppleMusicConnect(): { connect: () => Promise<string> } {
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
    return nativeRef.current.requestAndGetToken();
  }, []);

  return { connect };
}
