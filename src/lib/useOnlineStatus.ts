import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Network from "expo-network";

// Whether the device currently believes it has a network connection.
//
// Web: the standard `online`/`offline` window events (originally built
// for "Safari on an iPhone that walked into a dead zone").
//
// Native: expo-network's addNetworkStateListener, with a slow poll as
// a backstop in case the listener misses a transition on some device/
// OS combination. Before this, native unconditionally reported
// "online" (see git history) — harmless in most places since failed
// requests already degrade gracefully, but it meant Offline Mode's
// own banner claimed "Back online" while the device was genuinely
// offline (reported via TestFlight: airplane mode on, app still said
// back online).
function readNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return typeof navigator.onLine === "boolean" ? navigator.onLine : true;
}

const NATIVE_POLL_MS = 15000;
const PROBE_TIMEOUT_MS = 4000;

// The OS/browser's "offline" verdict alone isn't trustworthy enough to
// put the app into Offline Mode: on iOS, expo-network reports offline
// whenever its NWPathMonitor check times out or briefly sees an
// unsatisfied path (common on launch/resume and Wi-Fi <-> cellular
// handoffs), and navigator.onLine can be wrong too — both showed the
// offline banner on a perfectly good connection. So "offline" is only
// believed once a real request to our own backend also fails. Any HTTP
// response at all, even an error status, proves we're reachable.
async function backendReachable(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${url}/auth/v1/health`, {
      headers: key ? { apikey: key } : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let probeId = 0;
    // "Online" is believed immediately; "offline" only after the probe
    // above fails too. probeId drops a stale probe's answer if a newer
    // report has arrived since it started.
    const report = (reportedOnline: boolean) => {
      const id = ++probeId;
      if (reportedOnline) {
        if (!cancelled) setOnline(true);
        return;
      }
      void backendReachable().then((reachable) => {
        if (!cancelled && id === probeId) setOnline(reachable);
      });
    };

    if (Platform.OS === "web") {
      if (typeof window === "undefined" || !window.addEventListener) return;
      const goOnline = () => report(true);
      const goOffline = () => report(false);
      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
      // Re-sync in case an event fired between first render and this effect.
      report(readNavigatorOnline());
      // While we think we're offline, keep re-checking so the banner
      // clears on its own once the connection is back.
      const timer = setInterval(() => {
        if (!readNavigatorOnline()) report(false);
      }, NATIVE_POLL_MS);
      return () => {
        cancelled = true;
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
        clearInterval(timer);
      };
    }

    // isInternetReachable can be null mid-check on some platforms/
    // states — fall back to isConnected rather than treating
    // "unknown" as offline.
    const applyState = (state: { isConnected?: boolean; isInternetReachable?: boolean }) => {
      if (cancelled) return;
      report(state.isInternetReachable ?? state.isConnected ?? true);
    };
    const check = () => {
      Network.getNetworkStateAsync()
        .then(applyState)
        .catch(() => {
          // Best-effort — never flip to "offline" over a transient
          // failure to even ask the OS for its network state.
        });
    };
    check();
    const subscription = Network.addNetworkStateListener(applyState);
    const timer = setInterval(check, NATIVE_POLL_MS);
    return () => {
      cancelled = true;
      subscription.remove();
      clearInterval(timer);
    };
  }, []);

  return online;
}
