// Provider-agnostic diff logic for the My List -> Spotify/Apple Music
// playlist sync. Shared by both edge functions (Deno can import a plain
// .ts file with no React Native deps directly) and by this client module
// for tests/sanity-checking.
//
// Three sets, every sync:
//   myList  - track ids that should be in the playlist right now, per My
//             List + the user's sync-scope preference
//   live    - track ids actually in the playlist right now (fetched fresh
//             from the provider's API)
//   synced  - the ids JOMD is actively "managing" as of the last sync. This
//             is NOT a snapshot of `live` - see computeNewSynced below for
//             why that distinction is load-bearing.

export type SyncPlan = {
  toAdd: string[];
  toRemoveCandidates: string[];
};

/** toAdd: in myList, not already live, and never previously synced (so a
 *  track the user deliberately deleted from the provider's own app - still
 *  in myList, no longer live, but remembered in `synced` - is never
 *  resurrected).
 *
 *  toRemoveCandidates: was synced before, still sitting live and untouched
 *  by the user there, but no longer on My List. Never auto-removed - the
 *  caller must confirm with the user before acting on these. A track that
 *  sits in `live` but was never in `synced` (the user added it manually in
 *  the provider's own app) matches neither list, so it's always left
 *  alone. */
export function computeSyncPlan(
  myList: string[],
  live: string[],
  synced: string[],
): SyncPlan {
  const liveSet = new Set(live);
  const syncedSet = new Set(synced);
  const myListSet = new Set(myList);

  const toAdd = myList.filter((id) => !liveSet.has(id) && !syncedSet.has(id));
  const toRemoveCandidates = synced.filter(
    (id) => liveSet.has(id) && !myListSet.has(id),
  );

  return { toAdd, toRemoveCandidates };
}

/** The new `synced` set after a sync-apply step actually writes to the
 *  provider. Built from what the provider API confirmed, NOT from
 *  re-fetching `live` - re-fetching and overwriting `synced` with it would
 *  erase the very memory the diff depends on (a track deleted by the user
 *  in the provider's app would fall out of `live`, and if `synced` just
 *  mirrors `live` every time, the next sync would see it's "not live, not
 *  synced" and add it right back - silently undoing the user's deletion
 *  one cycle later).
 *
 *  confirmedAdded / confirmedRemoved: ids the provider API actually
 *  accepted for add/remove (only credit ids from batches that succeeded).
 *  confirmedKept: toRemoveCandidates the user answered "keep" to - dropped
 *  from `synced` bookkeeping (so they're never re-prompted, and if that
 *  dance re-enters My List later, computeSyncPlan sees it as already-live
 *  and leaves it alone) WITHOUT calling the provider's remove endpoint. */
export function computeNewSynced(
  synced: string[],
  confirmedAdded: string[],
  confirmedRemoved: string[],
  confirmedKept: string[],
): string[] {
  const drop = new Set([...confirmedRemoved, ...confirmedKept]);
  const next = new Set(synced.filter((id) => !drop.has(id)));
  confirmedAdded.forEach((id) => next.add(id));
  return [...next];
}
