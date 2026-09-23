import { Linking, Platform } from "react-native";

// iOS "Add to Home Screen" apps run in standalone mode with no tab UI at
// all. react-native-web's Linking.openURL opens links via
// window.open(url, "_blank") by default, which in that mode spawns a
// genuinely separate Safari browsing context rather than a real tab. A
// link like a YouTube URL gets intercepted by iOS's Universal Links and
// handed off to the YouTube app before that spawned Safari context ever
// paints anything — so switching back leaves a blank Safari shell (the
// "Search or enter website name" screen) sitting in front of the PWA,
// which is still alive and untouched underneath. Opening same-tab
// (`_self`) instead avoids spawning that dangling context — the OS still
// intercepts and hands off to the native app, just without the empty
// Safari tab left behind. Only applies to iOS standalone web; a normal
// browser tab (where `_blank` behaves correctly) and the native app
// (where this whole codepath doesn't run) are untouched.
function isIOSStandaloneWeb(): boolean {
  if (Platform.OS !== "web") return false;
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

export function openExternalLink(url: string): Promise<void> {
  const target = isIOSStandaloneWeb() ? "_self" : undefined;
  return target
    ? (Linking.openURL as (url: string, target?: string) => Promise<void>)(url, target)
    : Linking.openURL(url);
}
