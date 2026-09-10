import { useEffect, useState } from "react";

// Whether the browser currently believes it has a network connection.
//
// Scoped to web on purpose: the offline-notepad feature targets "Safari on
// an iPhone that walked into a dead zone", where iOS fires the standard
// `online` / `offline` window events. On native (no NetInfo dependency) we
// just assume online — the app already degrades gracefully when a request
// fails.
function readNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return typeof navigator.onLine === "boolean" ? navigator.onLine : true;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(readNavigatorOnline);

  useEffect(() => {
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
  }, []);

  return online;
}
