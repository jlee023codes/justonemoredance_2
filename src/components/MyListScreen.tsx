import { Ref, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Dance, DanceProgress, LearningStatus } from "../types";
import { colors } from "../styles";
import { confirmAction, showAlert } from "../lib/alerts";
import {
  presentPaywall,
  presentPaywallIfNeeded,
  SYNC_ENTITLEMENT_ID,
  tierAtLeast,
  Tier,
} from "../lib/entitlements";
import { danceLimitFor } from "../lib/planLimits";
import { DanceCard, QuickStatus } from "./DanceCard";
import { searchDances } from "../lib/bootstepper";
import { BackToTopHandle, BackToTopScrollView } from "./BackToTopScrollView";
import { BulkActionBar, SelectModeButton } from "./BulkRemoveBar";
import { MyListToolsModal } from "./MyListToolsModal";
import { SearchInput } from "./SearchInput";
import { VenuePicker } from "./VenuePicker";
import {
  loadDancedVenues,
  loadVenueLinks,
  saveVenueDance,
  VenueOption,
} from "../services/venues";
import {
  buildMyList,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  MyListFilters,
  MyListSort,
  SORT_LABELS,
  StatusFilter,
  activeFilterCount,
} from "../lib/danceListView";
import { PlaylistSyncModal, PlaylistSyncProvider } from "./PlaylistSyncModal";
import { ProviderLogo } from "./ProviderLogo";
import { appleMusicTrackIdFromUrl } from "../lib/appleMusicTrackId";
import { youtubeVideoIdFromUrl } from "../lib/youtubeVideoId";
import {
  DEFAULT_YOUTUBE_SYNC_SCOPE,
  loadAppleMusicStatus,
  loadPlaylistSyncScope,
  loadSpotifyStatus,
  loadYoutubeStatus,
  loadYoutubeSyncScope,
  MusicAccountStatus,
  YoutubeAccountStatus,
  YoutubeStatusGroup,
} from "../services/musicSync";
import {
  applySpotifySync,
  createSpotifyPlaylist,
  planSpotifySync,
} from "../lib/spotifySync";
import {
  applyAppleMusicSync,
  createAppleMusicPlaylist,
  planAppleMusicSync,
} from "../lib/appleMusicSync";
import {
  applyYoutubeSync,
  createYoutubePlaylist,
  planYoutubeSync,
  YoutubePlaylistKind,
} from "../lib/youtubeSync";

const YOUTUBE_KIND_LABEL: Record<YoutubePlaylistKind, string> = {
  tutorials: "Tutorials",
  demos: "Demos",
};

// "learning" (the scope-group value) means want + learning dances
// together; "learned" means just learned ones. Each of YouTube's two
// kinds (Tutorials/Demos) has its own independently-configured set of
// these groups (Profile's two scope pickers) controlling which dances
// count toward that playlist.
function expandStatusGroups(groups: Set<YoutubeStatusGroup>): Set<LearningStatus> {
  const out = new Set<LearningStatus>();
  if (groups.has("learning")) {
    out.add("want");
    out.add("learning");
  }
  if (groups.has("learned")) out.add("learned");
  return out;
}

// Falls back to whatever was snapshotted on the progress row if BootStepper
// hasn't resolved the full dance yet.
function danceFromProgress(progress: DanceProgress): Dance {
  return {
    id: progress.danceId,
    name: progress.danceName ?? "Dance",
    defaultSong: progress.danceSong ?? "",
    difficulty: progress.danceDifficulty ?? "Beginner",
    details: "",
    songSwaps: [],
    snapshot: true,
    spotifyTrackId: progress.danceSpotifyTrackId,
    spotifyUrl: progress.danceSpotifyUrl,
    appleMusicUrl: progress.danceAppleMusicUrl,
    youtubeMusicUrl: progress.danceYoutubeMusicUrl,
    amazonMusicUrl: progress.danceAmazonMusicUrl,
    // No teachVideoUrl here — the effective video is progress.link, which
    // DanceCard already reads directly (seeded from BootStepper's teach
    // video the first time a dance is added; see handleQuickStatus).
  };
}

const STATUS_CHIPS: { status: StatusFilter; icon: string; label: string }[] = [
  { status: "want", icon: "♡", label: "Want to Learn" },
  { status: "learning", icon: "🎯", label: "Learning Now" },
  { status: "learned", icon: "★", label: "Learned" },
];

export function MyListScreen({
  userId,
  progress,
  catalogCache,
  onOpenDance,
  onQuickStatus,
  onRemoveDances,
  refreshKey,
  scrollRef,
  tier,
  onVenuesChanged,
  musicRefreshKey,
  onMusicChanged,
}: {
  userId: string;
  progress: Record<string, DanceProgress>;
  // Full BootStepper dances resolved by the parent — lets the cards show
  // choreographer / counts / swaps, and lets the filters see counts/walls/tags.
  catalogCache: Record<string, Dance>;
  onOpenDance: (dance: Dance) => void;
  onQuickStatus: (dance: Dance, status: QuickStatus) => void;
  onRemoveDances: (danceIds: string[]) => Promise<void>;
  // Bumped by the parent whenever a venue tie changes elsewhere.
  refreshKey: number;
  // Lets the header logo's "back to top" tap reach whichever screen is
  // currently mounted.
  scrollRef?: Ref<BackToTopHandle>;
  // Shows the "X of {limit} dances" note + upgrade prompt below "pro" tier,
  // and gates the sync Connect/Create/Sync actions ("sync" tier or above).
  tier: Tier;
  // Lets the parent bump its venuesRefreshKey after a bulk add-to-venue,
  // same as everywhere else a venue tie changes.
  onVenuesChanged?: () => void;
  // Bumped after a Spotify/Apple Music connect, disconnect, or Profile's
  // sync-scope preference changes — refreshes this screen's playlist row.
  musicRefreshKey: number;
  onMusicChanged?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<MyListFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<MyListSort>(DEFAULT_SORT);
  const [toolsOpen, setToolsOpen] = useState(false);

  const [userVenues, setUserVenues] = useState<VenueOption[]>([]);
  const [venueLinks, setVenueLinks] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelected = (danceId: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(danceId) ? next.delete(danceId) : next.add(danceId);
      return next;
    });

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([loadDancedVenues(userId), loadVenueLinks(userId)])
      .then(([venues, links]) => {
        setUserVenues(venues);
        setVenueLinks(links);
      })
      .catch((err: any) =>
        setError(err?.message ?? "Could not load your venues."),
      )
      .finally(() => setLoading(false));
  }, [userId, refreshKey]);

  const rows = useMemo(
    () =>
      Object.values(progress).map((p) => ({
        dance: catalogCache[p.danceId] ?? danceFromProgress(p),
        progress: p,
        venueIds: venueLinks[p.danceId] ?? [],
      })),
    [progress, catalogCache, venueLinks],
  );

  const visible = useMemo(
    () => buildMyList(rows, { search, filters, sort }),
    [rows, search, filters, sort],
  );

  // Live BootStepper fallback — only kicks in once there's something
  // typed. A blank search just shows your own list (today's behavior);
  // typing a name not already in rows pulls in the wider catalog, same
  // search Home used to run standalone. No dance ever lands here with a
  // forced "none" status — picking Want/Learning/Learned below *is* the
  // add, same mechanic DanceCard's onQuickStatus already provides.
  const [bootstepperResults, setBootstepperResults] = useState<Dance[]>([]);
  const [bootstepperLoading, setBootstepperLoading] = useState(false);
  const searchRequestId = useRef(0);
  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      setBootstepperResults([]);
      setBootstepperLoading(false);
      return;
    }
    const requestId = ++searchRequestId.current;
    setBootstepperLoading(true);
    const timer = setTimeout(() => {
      searchDances(trimmed)
        .then((found) => {
          if (searchRequestId.current !== requestId) return; // stale
          setBootstepperResults(found);
          setBootstepperLoading(false);
        })
        .catch(() => {
          if (searchRequestId.current !== requestId) return;
          setBootstepperLoading(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Only the ones not already on the list — a local match is shown
  // once, under YOUR DANCES, not duplicated here.
  const newBootstepperResults = useMemo(
    () => bootstepperResults.filter((d) => !progress[d.id]),
    [bootstepperResults, progress],
  );

  const toolsBadge = activeFilterCount(filters);
  const anyActive =
    search.trim().length > 0 ||
    filters.statuses.length > 0 ||
    toolsBadge > 0 ||
    sort.key !== DEFAULT_SORT.key ||
    sort.dir !== DEFAULT_SORT.dir;

  const toggleStatus = (status: StatusFilter) =>
    setFilters((f) => ({
      ...f,
      statuses: f.statuses.includes(status)
        ? f.statuses.filter((s) => s !== status)
        : [...f.statuses, status],
    }));

  const clearAll = () => {
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setSort(DEFAULT_SORT);
  };

  const removeWithConfirm = async (danceIds: string[], message: string) => {
    if (!danceIds.length) return;
    const ok = await confirmAction(
      danceIds.length === 1 ? "Remove this dance?" : "Remove these dances?",
      message,
      "Remove",
      true,
    );
    if (!ok) return;
    try {
      await onRemoveDances(danceIds);
      exitSelect();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove.");
    }
  };

  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const [addingToVenue, setAddingToVenue] = useState(false);
  const danceById = useMemo(
    () => new Map(rows.map((r) => [r.dance.id, r.dance])),
    [rows],
  );

  // Playlist sync — Spotify / Apple Music. Track ids are computed from
  // whatever's currently on My List (dance.spotifyTrackId /
  // appleMusicUrl), filtered by the user's Profile sync-scope preference —
  // this is the client's own data, trusted the same way any other
  // self-owned write is (see supabase/functions/spotify-sync's comments).
  const [spotifyStatus, setSpotifyStatus] = useState<MusicAccountStatus | null>(null);
  const [appleMusicStatus, setAppleMusicStatus] = useState<MusicAccountStatus | null>(null);
  const [youtubeStatus, setYoutubeStatus] = useState<YoutubeAccountStatus | null>(null);
  const [syncScopeStatuses, setSyncScopeStatuses] = useState<Set<string>>(
    new Set(["learning", "learned"]),
  );
  // Independently-configured per kind (Profile's two scope pickers) —
  // which dances count toward the Tutorials playlist vs. the Demos one.
  const [youtubeTutorialsScope, setYoutubeTutorialsScope] = useState<Set<YoutubeStatusGroup>>(
    new Set(DEFAULT_YOUTUBE_SYNC_SCOPE),
  );
  const [youtubeDemosScope, setYoutubeDemosScope] = useState<Set<YoutubeStatusGroup>>(
    new Set(DEFAULT_YOUTUBE_SYNC_SCOPE),
  );
  // Spotify/Apple Music's existing single-target flow — unchanged.
  const [syncingProvider, setSyncingProvider] = useState<PlaylistSyncProvider | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    provider: "spotify" | "apple";
    trackIds: string[];
    danceNames: string[];
    addTrackIds: string[];
  } | null>(null);
  // YouTube's own confirm flow — see handleYoutubeSync below. A promise
  // resolver rather than reusing pendingRemoval's shape, since one
  // button press can need to ask about Tutorials AND Demos in sequence;
  // this lets handleYoutubeSync stay a single straightforward async
  // function (await the modal, keep going) instead of hand-rolling a
  // multi-step state machine across renders.
  const [youtubeConfirm, setYoutubeConfirm] = useState<{
    kind: YoutubePlaylistKind;
    danceNames: string[];
    resolve: (keep: boolean | null) => void;
  } | null>(null);

  useEffect(() => {
    loadSpotifyStatus(userId).then(setSpotifyStatus).catch(() => {});
    loadAppleMusicStatus(userId).then(setAppleMusicStatus).catch(() => {});
    loadYoutubeStatus(userId).then(setYoutubeStatus).catch(() => {});
    loadPlaylistSyncScope(userId)
      .then((scope) => setSyncScopeStatuses(new Set(scope)))
      .catch(() => {});
    loadYoutubeSyncScope(userId, "tutorials")
      .then((scope) => setYoutubeTutorialsScope(new Set(scope)))
      .catch(() => {});
    loadYoutubeSyncScope(userId, "demos")
      .then((scope) => setYoutubeDemosScope(new Set(scope)))
      .catch(() => {});
  }, [userId, musicRefreshKey]);

  const scopedRows = useMemo(
    () => rows.filter((r) => syncScopeStatuses.has(r.progress.status)),
    [rows, syncScopeStatuses],
  );
  // Each kind's own rows, filtered by that kind's own scope (Profile's
  // two independent pickers) — expandStatusGroups turns "learning" into
  // {want, learning} and "learned" into {learned}.
  const youtubeTutorialsRows = useMemo(() => {
    const statuses = expandStatusGroups(youtubeTutorialsScope);
    return rows.filter((r) => statuses.has(r.progress.status));
  }, [rows, youtubeTutorialsScope]);
  const youtubeDemosRows = useMemo(() => {
    const statuses = expandStatusGroups(youtubeDemosScope);
    return rows.filter((r) => statuses.has(r.progress.status));
  }, [rows, youtubeDemosScope]);

  const spotifyTrackIds = useMemo(
    () => [...new Set(scopedRows.map((r) => r.dance.spotifyTrackId).filter((id): id is string => !!id))],
    [scopedRows],
  );
  const appleMusicTrackIds = useMemo(
    () =>
      [...new Set(
        scopedRows
          .map((r) => appleMusicTrackIdFromUrl(r.dance.appleMusicUrl))
          .filter((id): id is string => !!id),
      )],
    [scopedRows],
  );
  // Dances in scope with no resolvable track for this provider — BootStepper
  // just doesn't have a Spotify/Apple Music link for them. Silently
  // dropping these from the playlist with no explanation would be
  // confusing (fewer tracks than dances, no obvious reason why), so the
  // list surfaces in the create/sync result alert below.
  const unmatchedLabel = (r: (typeof scopedRows)[number]) =>
    r.dance.defaultSong || r.dance.name;
  const spotifyUnmatched = useMemo(
    () => scopedRows.filter((r) => !r.dance.spotifyTrackId).map(unmatchedLabel),
    [scopedRows],
  );
  const appleMusicUnmatched = useMemo(
    () =>
      scopedRows
        .filter((r) => !appleMusicTrackIdFromUrl(r.dance.appleMusicUrl))
        .map(unmatchedLabel),
    [scopedRows],
  );

  // Tutorials reads progress.link (the same field the "Watch video" chip
  // reads — see danceFromProgress's comment above), since the effective
  // reference video is user-editable and not necessarily what BootStepper
  // originally provided. Demos reads dance.demoVideoUrl instead — pure
  // catalog data, never user-editable.
  const youtubeVideoUrlFor = (kind: YoutubePlaylistKind, r: (typeof rows)[number]) =>
    kind === "tutorials" ? r.progress.link : r.dance.demoVideoUrl;
  const youtubeTrackIds = (kind: YoutubePlaylistKind, kindRows: typeof rows) =>
    [...new Set(
      kindRows
        .map((r) => youtubeVideoIdFromUrl(youtubeVideoUrlFor(kind, r)))
        .filter((id): id is string => !!id),
    )];
  const youtubeTutorialsTrackIds = useMemo(
    () => youtubeTrackIds("tutorials", youtubeTutorialsRows),
    [youtubeTutorialsRows],
  );
  const youtubeDemosTrackIds = useMemo(
    () => youtubeTrackIds("demos", youtubeDemosRows),
    [youtubeDemosRows],
  );
  // No song title is available client-side for a video the way song names
  // are for music — the dance name is the only label on hand for the
  // "Skipped:" note here.
  const youtubeUnmatchedNames = (kind: YoutubePlaylistKind, kindRows: typeof rows) =>
    kindRows
      .filter((r) => !youtubeVideoIdFromUrl(youtubeVideoUrlFor(kind, r)))
      .map((r) => r.dance.name);
  const youtubeTutorialsUnmatched = useMemo(
    () => youtubeUnmatchedNames("tutorials", youtubeTutorialsRows),
    [youtubeTutorialsRows],
  );
  const youtubeDemosUnmatched = useMemo(
    () => youtubeUnmatchedNames("demos", youtubeDemosRows),
    [youtubeDemosRows],
  );

  // For the "keep or remove?" confirmation copy — a track/video id can map
  // to more than one dance (two choreographies, same song/video), so
  // every matching name is listed, not just one. `sourceRows` lets the
  // caller pick which scoped-rows array to search (music providers share
  // one scope, YouTube has its own).
  function danceNamesForTrackIds(
    trackIds: string[],
    byTrackId: (r: (typeof scopedRows)[number]) => string | null,
    sourceRows: typeof scopedRows = scopedRows,
  ) {
    const names = new Map<string, string[]>();
    for (const r of sourceRows) {
      const id = byTrackId(r);
      if (!id) continue;
      names.set(id, [...(names.get(id) ?? []), r.dance.name]);
    }
    return [...new Set(trackIds.flatMap((id) => names.get(id) ?? [id]))];
  }

  // YouTube-specific version of the above — removal candidates are, by
  // definition, usually no longer on My List at all (that's exactly why
  // they're being proposed for removal), so looking them up in `cfg.rows`
  // (today's scoped rows) alone was hitting the function's "no match
  // found" fallback and showing the raw video id instead of a name. Two
  // fallback passes instead: first every current My List row regardless
  // of status/scope (catches a dance that just moved out of this kind's
  // scope, not removed outright), then catalogCache (every dance this
  // session has ever resolved, whether still on My List or not) matched
  // against that kind's own catalog video field — teachVideoUrl for
  // Tutorials, demoVideoUrl for Demos. That catalog field is BootStepper's
  // default, not necessarily the exact progress.link a user may have since
  // customized on a now-removed Tutorials dance, but it's far better than
  // a bare id in the overwhelmingly common case.
  function youtubeDanceNamesForTrackIds(
    kind: YoutubePlaylistKind,
    trackIds: string[],
  ): string[] {
    const names = new Map<string, string[]>();
    for (const r of rows) {
      const id = youtubeVideoIdFromUrl(youtubeVideoUrlFor(kind, r));
      if (!id) continue;
      names.set(id, [...(names.get(id) ?? []), r.dance.name]);
    }
    for (const dance of Object.values(catalogCache)) {
      const url = kind === "tutorials" ? dance.teachVideoUrl : dance.demoVideoUrl;
      const id = youtubeVideoIdFromUrl(url);
      if (!id || names.has(id)) continue;
      names.set(id, [dance.name]);
    }
    return [...new Set(trackIds.flatMap((id) => names.get(id) ?? [id]))];
  }

  // Everything that differs between Spotify and Apple Music, keyed once so
  // handlePlaylistSync/resolvePendingRemoval read the same shape regardless
  // of which one is running. `apply` is typed loosely (both are
  // {add,remove,keep: string[]} on the wire either way). YouTube has its
  // own separate config/handler below — it's not a single target the way
  // these two are (one button drives both its playlists at once).
  const providerConfig = (target: "spotify" | "apple") => {
    switch (target) {
      case "spotify":
        return {
          status: spotifyStatus,
          trackIds: spotifyTrackIds,
          unmatched: spotifyUnmatched,
          rows: scopedRows,
          byTrackId: (r: (typeof scopedRows)[number]) => r.dance.spotifyTrackId ?? null,
          displayName: "Spotify",
          noun: "song",
          create: createSpotifyPlaylist,
          plan: planSpotifySync,
          apply: (args: { add: string[]; remove: string[]; keep: string[] }) =>
            applySpotifySync({
              addTrackIds: args.add,
              removeTrackIds: args.remove,
              keepTrackIds: args.keep,
            }),
        };
      case "apple":
        return {
          status: appleMusicStatus,
          trackIds: appleMusicTrackIds,
          unmatched: appleMusicUnmatched,
          rows: scopedRows,
          byTrackId: (r: (typeof scopedRows)[number]) =>
            appleMusicTrackIdFromUrl(r.dance.appleMusicUrl),
          displayName: "Apple Music",
          noun: "song",
          create: createAppleMusicPlaylist,
          plan: planAppleMusicSync,
          apply: (args: { add: string[]; remove: string[]; keep: string[] }) =>
            applyAppleMusicSync({
              addTrackIds: args.add,
              removeTrackIds: args.remove,
              keepTrackIds: args.keep,
            }),
        };
    }
  };

  const handlePlaylistSync = async (target: "spotify" | "apple") => {
    const { status, trackIds, unmatched, displayName, noun, create, plan, apply } =
      providerConfig(target);
    const unmatchedNote = unmatched.length
      ? `\n\nSkipped:\n${unmatched.map((l) => `• ${l}`).join("\n")}`
      : "";
    if (!tierAtLeast(tier, "sync")) return void presentPaywallIfNeeded(SYNC_ENTITLEMENT_ID);
    if (!trackIds.length) {
      showAlert(
        "Nothing to sync yet",
        "Move a dance to Learning or Learned (or adjust your sync scope in Profile) — dances need a matching song to sync.",
      );
      return;
    }
    setSyncingProvider(target);
    try {
      if (!status?.connected) return; // row isn't rendered in this state; guard anyway

      if (!status.playlistId) {
        const result = await create(trackIds);
        showAlert(
          "Playlist created 🎉",
          `${result.trackCount} ${noun}${result.trackCount === 1 ? "" : "s"} added.${unmatchedNote}`,
        );
        onMusicChanged?.();
        return;
      }

      const syncPlan = await plan(trackIds);
      if (syncPlan.playlistMissing) {
        onMusicChanged?.(); // refreshes status — button flips back to "Create"
        showAlert(
          "Playlist no longer exists",
          `Looks like your ${displayName} playlist was deleted. Tap Create to make a new one.`,
        );
        return;
      }
      if (syncPlan.toRemoveCandidateTrackIds.length) {
        const { byTrackId, rows: sourceRows } = providerConfig(target);
        setPendingRemoval({
          provider: target,
          trackIds: syncPlan.toRemoveCandidateTrackIds,
          danceNames: danceNamesForTrackIds(
            syncPlan.toRemoveCandidateTrackIds,
            byTrackId,
            sourceRows,
          ),
          addTrackIds: syncPlan.toAddTrackIds,
        });
        return;
      }

      const result = await apply({ add: syncPlan.toAddTrackIds, remove: [], keep: [] });
      showAlert(
        "Synced",
        (result.added
          ? `${result.added} ${noun}${result.added === 1 ? "" : "s"} added.`
          : "Your playlist is already up to date.") + unmatchedNote,
      );
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Sync failed", err?.message ?? "Please try again.");
    } finally {
      setSyncingProvider(null);
    }
  };

  const resolvePendingRemoval = async (keep: boolean) => {
    if (!pendingRemoval) return;
    const { provider, trackIds, addTrackIds } = pendingRemoval;
    const { apply, unmatched } = providerConfig(provider);
    const unmatchedNote = unmatched.length
      ? `\n\nSkipped:\n${unmatched.map((l) => `• ${l}`).join("\n")}`
      : "";
    setPendingRemoval(null);
    setSyncingProvider(provider);
    try {
      const result = await apply({
        add: addTrackIds,
        remove: keep ? [] : trackIds,
        keep: keep ? trackIds : [],
      });
      showAlert(
        "Synced",
        `${result.added} added, ${result.removed} removed.${unmatchedNote}`,
      );
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Sync failed", err?.message ?? "Please try again.");
    } finally {
      setSyncingProvider(null);
    }
  };

  // YouTube: one button drives both playlists (Tutorials, Demos) in one
  // press, per the "code-wise one button" design — unlike Spotify/Apple's
  // single-target flow above, this needs to sequentially ask about
  // removal candidates for up to two playlists in one run, hence the
  // promise-based askYoutubeKeepOrRemove instead of the pendingRemoval
  // state round-trip those use.
  const youtubeTargetConfig = (kind: YoutubePlaylistKind) => {
    const kindStatus = youtubeStatus?.[kind] ?? { playlistId: null, playlistUrl: null };
    return {
      status: youtubeStatus
        ? {
            connected: youtubeStatus.connected,
            playlistId: kindStatus.playlistId,
            playlistUrl: kindStatus.playlistUrl,
          }
        : null,
      trackIds: kind === "tutorials" ? youtubeTutorialsTrackIds : youtubeDemosTrackIds,
      unmatched: kind === "tutorials" ? youtubeTutorialsUnmatched : youtubeDemosUnmatched,
      create: async (videoIds: string[]) => {
        const result = await createYoutubePlaylist(kind, videoIds);
        return { playlistId: result.playlistId, playlistUrl: result.playlistUrl, trackCount: result.videoCount };
      },
      plan: async (videoIds: string[]) => {
        const result = await planYoutubeSync(kind, videoIds);
        return {
          playlistMissing: result.playlistMissing,
          toAddTrackIds: result.toAddVideoIds,
          toRemoveCandidateTrackIds: result.toRemoveCandidateVideoIds,
        };
      },
      apply: async (args: { add: string[]; remove: string[]; keep: string[] }) =>
        applyYoutubeSync(kind, {
          addVideoIds: args.add,
          removeVideoIds: args.remove,
          keepVideoIds: args.keep,
        }),
    };
  };

  const askYoutubeKeepOrRemove = (
    kind: YoutubePlaylistKind,
    danceNames: string[],
  ): Promise<boolean | null> =>
    new Promise((resolve) => setYoutubeConfirm({ kind, danceNames, resolve }));

  const handleYoutubeSync = async () => {
    if (!tierAtLeast(tier, "sync")) return void presentPaywallIfNeeded(SYNC_ENTITLEMENT_ID);
    const kinds: YoutubePlaylistKind[] = ["tutorials", "demos"];
    const anyTrackIds = kinds.some((k) => youtubeTargetConfig(k).trackIds.length > 0);
    if (!anyTrackIds) {
      showAlert(
        "Nothing to sync yet",
        "Move a dance to Learning or Learned (or adjust your Tutorials/Demos sync settings in Profile) — dances need a reference or demo video to sync.",
      );
      return;
    }
    setSyncingProvider("youtube");
    try {
      let addedTotal = 0;
      let removedTotal = 0;
      const notes: string[] = [];
      for (const kind of kinds) {
        const cfg = youtubeTargetConfig(kind);
        if (!cfg.trackIds.length || !cfg.status?.connected) continue;
        if (cfg.unmatched.length) {
          notes.push(
            `${YOUTUBE_KIND_LABEL[kind]} skipped:\n${cfg.unmatched.map((l) => `• ${l}`).join("\n")}`,
          );
        }

        if (!cfg.status.playlistId) {
          const result = await cfg.create(cfg.trackIds);
          addedTotal += result.trackCount;
          continue;
        }

        const plan = await cfg.plan(cfg.trackIds);
        if (plan.playlistMissing) {
          notes.push(`${YOUTUBE_KIND_LABEL[kind]}: playlist was deleted — tap Sync again to recreate it.`);
          continue;
        }

        let removeIds: string[] = [];
        let keepIds: string[] = [];
        if (plan.toRemoveCandidateTrackIds.length) {
          const danceNames = youtubeDanceNamesForTrackIds(kind, plan.toRemoveCandidateTrackIds);
          const decision = await askYoutubeKeepOrRemove(kind, danceNames);
          if (decision === null) continue; // deferred — skip this kind entirely this run
          if (decision) keepIds = plan.toRemoveCandidateTrackIds;
          else removeIds = plan.toRemoveCandidateTrackIds;
        }
        if (!plan.toAddTrackIds.length && !removeIds.length && !keepIds.length) continue;

        const result = await cfg.apply({ add: plan.toAddTrackIds, remove: removeIds, keep: keepIds });
        addedTotal += result.added;
        removedTotal += result.removed;
      }
      showAlert(
        "Synced",
        `${addedTotal} added, ${removedTotal} removed.` + notes.map((n) => `\n\n${n}`).join(""),
      );
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Sync failed", err?.message ?? "Please try again.");
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleAddSelectedToVenue = async (venue: VenueOption) => {
    setVenuePickerOpen(false);
    const danceIds = [...selectedIds];
    if (!danceIds.length) return;
    setAddingToVenue(true);
    try {
      let added = 0;
      for (const danceId of danceIds) {
        const dance = danceById.get(danceId);
        if (!dance) continue;
        await saveVenueDance(userId, venue.id, dance, "");
        added++;
      }
      onVenuesChanged?.();
      exitSelect();
      showAlert(
        "Added to venue",
        `${added} dance${added === 1 ? "" : "s"} tagged to ${venue.name}.`,
      );
    } catch (err: any) {
      setError(err?.message ?? "Could not add to that venue.");
    } finally {
      setAddingToVenue(false);
    }
  };

  const nothingSaved = rows.length === 0;
  const canManage = !nothingSaved;

  const [presentingUpgrade, setPresentingUpgrade] = useState(false);
  const handleUpgrade = async () => {
    setPresentingUpgrade(true);
    try {
      const result = await presentPaywall();
      if (result === "purchased" || result === "restored") {
        showAlert("You're in! 🎉", "Premium is unlocked — no more list limit.");
      } else if (result === "error") {
        showAlert(
          "Something went wrong",
          "Could not load the paywall. Check your connection and try again.",
        );
      }
    } finally {
      setPresentingUpgrade(false);
    }
  };

  return (
    <>
      <BackToTopScrollView
        ref={scrollRef}
        hideFab={selectMode}
        contentContainerStyle={[s.page, selectMode && s.pageSelecting]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.headerRow}>
          <Text style={s.heading}>My List</Text>
          {(spotifyStatus?.connected || appleMusicStatus?.connected || youtubeStatus?.connected) && (
            <View style={s.headerSyncButtons}>
              {appleMusicStatus?.connected && (
                <Pressable
                  style={[s.syncButton, syncingProvider === "apple" && s.disabled]}
                  onPress={() => handlePlaylistSync("apple")}
                  disabled={syncingProvider !== null}
                >
                  {syncingProvider === "apple" ? (
                    <ActivityIndicator color={colors.gold} size="small" />
                  ) : (
                    <>
                      <ProviderLogo provider="apple" />
                      <Text style={s.syncButtonText} numberOfLines={1}>
                        {appleMusicStatus.playlistId ? "Sync" : "Create"}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
              {spotifyStatus?.connected && (
                <Pressable
                  style={[s.syncButton, syncingProvider === "spotify" && s.disabled]}
                  onPress={() => handlePlaylistSync("spotify")}
                  disabled={syncingProvider !== null}
                >
                  {syncingProvider === "spotify" ? (
                    <ActivityIndicator color={colors.gold} size="small" />
                  ) : (
                    <>
                      <ProviderLogo provider="spotify" />
                      <Text style={s.syncButtonText} numberOfLines={1}>
                        {spotifyStatus.playlistId ? "Sync" : "Create"}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
              {youtubeStatus?.connected && (
                <Pressable
                  style={[s.syncButton, syncingProvider === "youtube" && s.disabled]}
                  onPress={handleYoutubeSync}
                  disabled={syncingProvider !== null}
                >
                  {syncingProvider === "youtube" ? (
                    <ActivityIndicator color={colors.gold} size="small" />
                  ) : (
                    <>
                      <ProviderLogo provider="youtube" />
                      <Text style={s.syncButtonText} numberOfLines={1}>
                        {youtubeStatus.tutorials.playlistId || youtubeStatus.demos.playlistId
                          ? "Sync"
                          : "Create"}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          )}
        </View>

        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search dances, songs, choreographers"
          style={s.search}
        />

        <View style={s.quickRow}>
          {STATUS_CHIPS.map((chip) => {
            const active = filters.statuses.includes(chip.status);
            return (
              <Pressable
                key={chip.status}
                style={[s.quickChip, active && s.quickChipOn]}
                onPress={() => toggleStatus(chip.status)}
                hitSlop={4}
              >
                <Text style={[s.quickIcon, active && s.quickTextOn]}>
                  {chip.icon}
                </Text>
                <Text
                  style={[s.quickLabel, active && s.quickTextOn]}
                  numberOfLines={1}
                >
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.toolsRow}>
          <Pressable
            style={[s.toolsButton, s.toolsButtonGrow]}
            onPress={() => setToolsOpen(true)}
          >
            <Text style={s.toolsButtonText}>
              ⚙ Filter &amp; sort · {SORT_LABELS[sort.key]}
            </Text>
            {toolsBadge > 0 && (
              <View style={s.toolsBadge}>
                <Text style={s.toolsBadgeText}>{toolsBadge}</Text>
              </View>
            )}
          </Pressable>
          {anyActive && (
            <Pressable style={s.clearInline} onPress={clearAll}>
              <Text style={s.clearInlineText}>Clear</Text>
            </Pressable>
          )}
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        {loading && !rows.length && (
          <ActivityIndicator color={colors.gold} style={s.loader} />
        )}

        <View style={s.listHead}>
          <View style={s.listHeadLeft}>
            <Text style={s.section}>YOUR DANCES</Text>
            <Text style={s.listHeadCount}>
              {visible.length} {visible.length === 1 ? "dance" : "dances"}
            </Text>
          </View>
          {canManage &&
            (selectMode ? (
              <Text style={s.selectCount}>{selectedIds.size} selected</Text>
            ) : (
              <SelectModeButton onPress={() => setSelectMode(true)} />
            ))}
        </View>

        {!tierAtLeast(tier, "pro") && (
          <View style={s.limitRow}>
            <Text style={s.limitText}>
              {rows.length} of {danceLimitFor(tier)} dances
            </Text>
            <Pressable
              onPress={handleUpgrade}
              disabled={presentingUpgrade}
              hitSlop={6}
            >
              <Text style={s.limitUpgrade}>
                {presentingUpgrade ? "Loading…" : "Upgrade ✨"}
              </Text>
            </Pressable>
          </View>
        )}

        {visible.map(({ dance, progress: p }) => (
          <DanceCard
            key={dance.id}
            dance={dance}
            song={dance.defaultSong}
            progress={p}
            selected={selectMode ? selectedIds.has(dance.id) : undefined}
            onPress={
              selectMode
                ? () => toggleSelected(dance.id)
                : () => onOpenDance(dance)
            }
            onQuickStatus={(status) => onQuickStatus(dance, status)}
            onDelete={
              selectMode
                ? undefined
                : () =>
                    removeWithConfirm(
                      [dance.id],
                      `Remove "${dance.name}" from your lists and every venue you've tagged it to?`,
                    )
            }
          />
        ))}

        {!loading && nothingSaved && !search.trim() && !error && (
          <Text style={s.empty}>
            Nothing saved yet — search above to find a dance and mark it
            Want to Learn, Learning Now, or Learned.
          </Text>
        )}
        {!nothingSaved && visible.length === 0 && !search.trim() && (
          <View>
            <Text style={s.empty}>No dances match your filters.</Text>
            <Pressable style={s.clearButton} onPress={clearAll}>
              <Text style={s.clearButtonText}>Clear search &amp; filters</Text>
            </Pressable>
          </View>
        )}

        {search.trim().length > 0 && (
          <View style={s.listHead}>
            <View style={s.listHeadLeft}>
              <Text style={s.section}>FROM BOOTSTEPPER</Text>
              {!bootstepperLoading && (
                <Text style={s.listHeadCount}>
                  {newBootstepperResults.length}{" "}
                  {newBootstepperResults.length === 1 ? "match" : "matches"}
                </Text>
              )}
            </View>
          </View>
        )}
        {search.trim().length > 0 && bootstepperLoading && !newBootstepperResults.length && (
          <ActivityIndicator color={colors.gold} style={s.loader} />
        )}
        {search.trim().length > 0 &&
          newBootstepperResults.map((dance) => (
            <DanceCard
              key={dance.id}
              dance={dance}
              song={dance.defaultSong}
              onPress={() => onOpenDance(dance)}
              onQuickStatus={(status) => onQuickStatus(dance, status)}
            />
          ))}
        {search.trim().length > 0 &&
          !bootstepperLoading &&
          !newBootstepperResults.length &&
          visible.length === 0 && (
            <Text style={s.empty}>
              No dances found — try a different search.
            </Text>
          )}
      </BackToTopScrollView>

      {selectMode && (
        <BulkActionBar
          count={selectedIds.size}
          onCancel={exitSelect}
          onAddToVenue={() => setVenuePickerOpen(true)}
          onRemove={() =>
            removeWithConfirm(
              [...selectedIds],
              `Remove ${selectedIds.size} dance${
                selectedIds.size === 1 ? "" : "s"
              } from your lists and every venue you've tagged them to?`,
            )
          }
        />
      )}

      <VenuePicker
        visible={venuePickerOpen}
        title={
          addingToVenue
            ? "Adding…"
            : `Add ${selectedIds.size} dance${selectedIds.size === 1 ? "" : "s"} to a venue`
        }
        userId={userId}
        onSelect={handleAddSelectedToVenue}
        onClose={() => setVenuePickerOpen(false)}
      />

      <MyListToolsModal
        visible={toolsOpen}
        onClose={() => setToolsOpen(false)}
        filters={filters}
        sort={sort}
        userVenues={userVenues}
        onFiltersChange={setFilters}
        onSortChange={setSort}
      />

      <PlaylistSyncModal
        visible={!!pendingRemoval}
        provider={pendingRemoval?.provider ?? "spotify"}
        danceNames={pendingRemoval?.danceNames ?? []}
        onKeep={() => resolvePendingRemoval(true)}
        onRemove={() => resolvePendingRemoval(false)}
        onClose={() => setPendingRemoval(null)}
      />

      <PlaylistSyncModal
        visible={!!youtubeConfirm}
        provider="youtube"
        label={youtubeConfirm ? `YouTube — ${YOUTUBE_KIND_LABEL[youtubeConfirm.kind]}` : undefined}
        danceNames={youtubeConfirm?.danceNames ?? []}
        onKeep={() => {
          youtubeConfirm?.resolve(true);
          setYoutubeConfirm(null);
        }}
        onRemove={() => {
          youtubeConfirm?.resolve(false);
          setYoutubeConfirm(null);
        }}
        onClose={() => {
          youtubeConfirm?.resolve(null);
          setYoutubeConfirm(null);
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  pageSelecting: { paddingBottom: 190 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 14,
    gap: 10,
  },
  heading: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
  },
  headerSyncButtons: { flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 0 },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 15,
  },
  quickRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  quickChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  quickChipOn: { borderColor: colors.pink, backgroundColor: "#3a1f30" },
  quickIcon: { fontSize: 12, color: colors.muted },
  quickLabel: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
  },
  quickTextOn: { color: colors.pink },
  toolsRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  toolsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  toolsButtonGrow: { flex: 1 },
  toolsButtonText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  clearInline: {
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  clearInlineText: { color: colors.pink, fontSize: 13, fontWeight: "800" },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 34,
  },
  syncButtonText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  disabled: { opacity: 0.5 },
  toolsBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  toolsBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 8,
  },
  listHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    flexShrink: 1,
  },
  listHeadCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    flexShrink: 0,
  },
  selectCount: { color: colors.muted, fontWeight: "800", fontSize: 12 },
  limitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  limitText: { color: colors.muted, fontSize: 12 },
  limitUpgrade: { color: colors.pink, fontSize: 12, fontWeight: "800" },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  clearButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  clearButtonText: { color: colors.pink, fontWeight: "800", fontSize: 13 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  loader: { marginTop: 20 },
});
