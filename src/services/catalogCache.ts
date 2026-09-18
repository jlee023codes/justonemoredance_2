import AsyncStorage from "@react-native-async-storage/async-storage";
import { Dance } from "../types";

// Persists resolved dance details (choreographer, counts, video/music
// links, …) across app launches, so My List doesn't show bare cards for a
// few seconds on *every* open while the background resolver re-fetches
// dances it already knew about last time. Only ever a speed-up — the
// normal resolver in App.tsx still runs the same as before and overwrites
// this with fresh data; a cache miss (or a stale one) just falls back to
// exactly today's behavior.
//
// Snapshots are deliberately never stored — there's nothing gained by
// caching a dance's bare name/song/difficulty over just re-deriving it
// from `progress` the way danceFromProgress already does.
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

type CachedEntry = { dance: Dance; cachedAt: number };

const keyFor = (userId: string) => `jomd.catalog-cache.${userId}`;

export async function loadCachedCatalog(
  userId: string,
): Promise<Record<string, Dance>> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedEntry>;
    const now = Date.now();
    const fresh: Record<string, Dance> = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (now - entry.cachedAt < TTL_MS) fresh[id] = entry.dance;
    }
    return fresh;
  } catch {
    return {};
  }
}

export async function saveCachedCatalog(
  userId: string,
  cache: Record<string, Dance>,
): Promise<void> {
  try {
    const now = Date.now();
    const toStore: Record<string, CachedEntry> = {};
    for (const [id, dance] of Object.entries(cache)) {
      if (!dance.snapshot) toStore[id] = { dance, cachedAt: now };
    }
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(toStore));
  } catch {
    // Best-effort — worst case just no speedup next launch.
  }
}
