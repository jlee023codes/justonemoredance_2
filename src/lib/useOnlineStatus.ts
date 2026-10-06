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

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    Platform.OS === "web" ? readNavigatorOnline() : true,
  );

  useEffect(() => {
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || !window.addEventListener) return;
      const goOnline = () => setOnline(true);
      const goOffline = () => setOnline(false);
      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
      // Re-sync in case an event fired between first render and this effect.
      setOnline(readNavigatorOnline());
      return () => {
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
      };
    }

    let cancelled = false;
    // isInternetReachable can be null mid-check on some platforms/
    // states — fall back to isConnected rather than treating
    // "unknown" as offline.
    const applyState = (state: { isConnected?: boolean; isInternetReachable?: boolean }) => {
      if (cancelled) return;
      setOnline(state.isInternetReachable ?? state.isConnected ?? true);
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
