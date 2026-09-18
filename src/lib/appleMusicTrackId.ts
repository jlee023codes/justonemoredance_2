// Apple's Web API needs a catalog song id to add a track to a playlist,
// but BootStepper only gives us a share URL (dance.appleMusicUrl). Apple's
// web links for a specific song carry the catalog id as the `i` query
// param — https://music.apple.com/us/album/<name>/<album-id>?i=<song-id> —
// a stable format Apple has used for years.
//
// UNVERIFIED against a live BootStepper response — confirm this against a
// real dance.appleMusicUrl value before relying on it for many dances. If
// some come back without an `i` param, they'll just be skipped (silently
// excluded from the playlist) rather than crash the sync; a catalog-search
// fallback (by song + artist name, mirroring searchTeachVideoUrl's
// pattern in src/lib/bootstepper.ts) is a reasonable follow-up if that
// turns out to be common.

export function appleMusicTrackIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("i");
    return id || null;
  } catch {
    return null;
  }
}
