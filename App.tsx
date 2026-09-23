import { useEffect, useRef, useState } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { Dance, DanceProgress } from "./src/types";
import { AppTab, BottomTabs } from "./src/components/BottomTabs";
import {
  BackToTopHandle,
  BackToTopScrollView,
} from "./src/components/BackToTopScrollView";
import { DanceCard } from "./src/components/DanceCard";
import { SearchInput } from "./src/components/SearchInput";
import { DanceDetailsModal } from "./src/components/DanceDetailsModal";
import { MyListScreen } from "./src/components/MyListScreen";
import { VenuesScreen } from "./src/components/VenuesScreen";
import { FriendsScreen } from "./src/components/FriendsScreen";
import { PaywallScreen } from "./src/components/PaywallScreen";
import { StatusLegendModal } from "./src/components/StatusLegendModal";
import { HelpModal } from "./src/components/HelpModal";
import { OfflineBanner } from "./src/components/OfflineBanner";
import { OfflineListModal } from "./src/components/OfflineListModal";
import { colors } from "./src/styles";
import { AuthScreen } from "./src/components/AuthScreen";
import { ProfileScreen } from "./src/components/ProfileScreen";
import { ResetPasswordScreen } from "./src/components/ResetPasswordScreen";
import { supabase } from "./src/lib/supabase";
import { confirmAction, showAlert } from "./src/lib/alerts";
import {
  reachedDanceLimit,
  DANCE_LIMIT_TITLE,
  DANCE_LIMIT_MESSAGE,
} from "./src/lib/planLimits";
import { useOnlineStatus } from "./src/lib/useOnlineStatus";
import {
  configurePurchases,
  loginPurchases,
  logoutPurchases,
  subscribeToPremiumStatus,
} from "./src/lib/entitlements";
import {
  clearOfflineList,
  countOfflineList,
  OfflineDance,
} from "./src/services/offlineList";
import { queueImport } from "./src/services/notesImport";
import {
  applyRecoveryLink,
  clearRecoveryLinkFromUrl,
  parseRecoveryLink,
} from "./src/lib/authLinks";
import { consumeWebSpotifyCallback, SpotifyAuthResult } from "./src/lib/spotifyAuth";
import { exchangeSpotifyCode } from "./src/lib/spotifySync";
import { fetchAppleMusicDeveloperToken } from "./src/lib/appleMusicSync";
import { consumeWebGoogleCallback, GoogleAuthResult } from "./src/lib/googleAuth";
import { exchangeYoutubeCode } from "./src/lib/youtubeSync";
import { AppleMusicProviderGate } from "./src/components/AppleMusicProviderGate";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { initErrorReporting, reportError } from "./src/lib/errorReporting";

// As early as possible — before the app root even renders — so a crash
// during the very first render is still caught, not just ones after
// Sentry happened to already be configured.
initErrorReporting();
import {
  loadProgress,
  saveProgress,
  removeDancesEverywhere,
  backfillDanceLinks,
  setDanceLink,
} from "./src/services/progress";
import { loadFriendRequests } from "./src/services/friends";
import { saveVenueDance } from "./src/services/venues";
import {
  loadCachedCatalog,
  saveCachedCatalog,
} from "./src/services/catalogCache";
import { searchDances, getDancesByIds } from "./src/lib/bootstepper";
import { Session } from "@supabase/supabase-js";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export default function App() {
  return (
    <ErrorBoundary onError={reportError}>
      <AppRoot />
    </ErrorBoundary>
  );
}

function AppRoot() {
  const [tab, setTab] = useState<AppTab>("Home"),
    [query, setQuery] = useState(""),
    [progress, setProgress] = useState<Record<string, DanceProgress>>({}),
    [selected, setSelected] = useState<Dance | null>(null),
    [message, setMessage] = useState(""),
    [session, setSession] = useState<Session | null>(null),
    [authLoading, setAuthLoading] = useState(true),
    // Search results shown on the Home tab, straight from BootStepper —
    // Home always searches the full catalog ("everywhere"), with no venue
    // filter. Venue association happens per-dance, in the details modal.
    [searchResults, setSearchResults] = useState<Dance[]>([]),
    [searchLoading, setSearchLoading] = useState(true),
    // Every Dance object we've seen from any source (search, direct fetch by
    // id, received/friend dances) — lets Want/Learned resolve a full Dance
    // even when it's not in the current Home search results.
    [catalogCache, setCatalogCache] = useState<Record<string, Dance>>({}),
    [venuesRefreshKey, setVenuesRefreshKey] = useState(0),
    // Bumped after a Spotify connect/disconnect completes, so Profile's
    // and My List's connection-status reads refresh.
    [musicRefreshKey, setMusicRefreshKey] = useState(0),
    // True once a password-reset link has been turned into a session and
    // we owe the user a "pick a new password" screen.
    [resetPassword, setResetPassword] = useState(false),
    [pendingRequestCount, setPendingRequestCount] = useState(0),
    [legendOpen, setLegendOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    // Bumped on every auth event that carries a session. On a cold start
    // (or a Metro "reload app"), the *first* loadProgress() can race the
    // Supabase client finishing its session restore and come back empty —
    // RLS returns nothing to an as-yet-unauthenticated request, with no
    // error, so nothing retries and you're left staring at an empty list.
    // The INITIAL_SESSION / TOKEN_REFRESHED events fire once the client is
    // ready; keying the loaders off this epoch gives them an authenticated
    // second shot even when the user id never changed.
    [sessionEpoch, setSessionEpoch] = useState(0),
    // The on-device "offline notepad": whether it's open, and how many
    // lines are sitting in it waiting to be imported.
    [offlineOpen, setOfflineOpen] = useState(false),
    [offlineCount, setOfflineCount] = useState(0),
    // Set when an offline import has been queued, so the Profile tab opens
    // straight into the matcher.
    [openImportOnProfile, setOpenImportOnProfile] = useState(false),
    // Gates the Venues/Friends tabs — a real RevenueCat entitlement OR a
    // manual server comp (profiles.is_premium). See src/lib/entitlements.ts.
    [isPremium, setIsPremium] = useState(false);

  const online = useOnlineStatus();
  // Only one of Home / My List / Venues / Friends is ever mounted at a
  // time, so one ref is enough — it naturally points at whichever screen's
  // BackToTopScrollView is currently on screen (and goes null on Profile,
  // where tapping the logo is then just a no-op).
  const activeScrollRef = useRef<BackToTopHandle>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (nextSession) setSessionEpoch((n) => n + 1);
      if (event === "PASSWORD_RECOVERY") {
        // Web only: supabase-js read the recovery tokens out of the URL
        // fragment itself (detectSessionInUrl). Wipe them so a refresh
        // doesn't try to replay a spent token.
        setResetPassword(true);
        clearRecoveryLinkFromUrl();
      }
      if (event === "SIGNED_OUT") {
        setResetPassword(false);
        setProgress({});
        setPendingRequestCount(0);
        setIsPremium(false);
        // So a next sign-in (possibly a different account, shared device)
        // doesn't briefly inherit this customer's entitlement.
        void logoutPurchases();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Native side of the password-reset flow. On web, supabase-js handles
  // the URL itself; on iOS/Android the deep link arrives here instead and
  // we exchange it for a session by hand. See src/lib/authLinks.ts.
  const deepLink = Linking.useLinkingURL();
  useEffect(() => {
    if (Platform.OS === "web") return;
    const link = parseRecoveryLink(deepLink);
    if (!link) return;
    applyRecoveryLink(link)
      .then(() => setResetPassword(true))
      .catch((err: any) =>
        showAlert(
          "That link didn't work",
          err?.message ??
            "Request a new password reset link from the sign-in screen.",
        ),
      );
  }, [deepLink]);

  // Web side of Spotify's OAuth round trip. Unlike the recovery-link
  // effect above, native needs nothing here — expo-auth-session's
  // promptAsync() (see src/lib/spotifyAuth.ts) resolves its own promise
  // directly from within the ASWebAuthenticationSession it opens, without
  // going through this app-wide deep-link listener. Web instead does a
  // full-page redirect to Spotify and back to this same origin (there's no
  // dedicated /spotify-callback route — see spotifyAuth.ts for why), so
  // this only has a query string to read on the next page load, once,
  // here.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const result = consumeWebSpotifyCallback();
    if (!result) return;
    handleSpotifyAuthResult(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSpotifyAuthResult = (result: SpotifyAuthResult) => {
    if (result.kind === "cancelled") return;
    if (result.kind === "error") {
      showAlert("Spotify connection failed", result.message);
      return;
    }
    exchangeSpotifyCode(result.code, result.codeVerifier, result.redirectUri)
      .then(() => setMusicRefreshKey((k) => k + 1))
      .catch((err: any) =>
        showAlert(
          "Spotify connection failed",
          err?.message ?? "Could not finish connecting to Spotify.",
        ),
      );
  };

  // Web side of YouTube's (Google) OAuth round trip — same shape as
  // Spotify's above, sharing this same effect/mount since both land on
  // the same root URL; consumeWebGoogleCallback's `?provider=youtube`
  // guard (see googleAuth.ts) is what tells the two apart.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const result = consumeWebGoogleCallback();
    if (!result) return;
    handleGoogleAuthResult(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleAuthResult = (result: GoogleAuthResult) => {
    if (result.kind === "cancelled") return;
    if (result.kind === "error") {
      showAlert("YouTube connection failed", result.message);
      return;
    }
    exchangeYoutubeCode(result.code, result.codeVerifier, result.redirectUri, result.platform)
      .then(() => setMusicRefreshKey((k) => k + 1))
      .catch((err: any) =>
        showAlert(
          "YouTube connection failed",
          err?.message ?? "Could not finish connecting to YouTube.",
        ),
      );
  };

  // Apple Music's native provider (ProfileScreen's Connect button needs it
  // mounted as an ancestor — see AppleMusicProviderGate) needs a Developer
  // Token up front. Web doesn't use this at all — MusicKit JS fetches its
  // own directly (see appleMusicAuth.tsx). Fetched once per session; the
  // provider works fine mounted with an undefined token until this lands.
  const [appleDeveloperToken, setAppleDeveloperToken] = useState<string | undefined>();
  useEffect(() => {
    if (Platform.OS === "web" || !session) return;
    fetchAppleMusicDeveloperToken()
      .then(setAppleDeveloperToken)
      .catch(() => {}); // Connect button just fails with a clear error later if this never lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  // Pull the saved want/learning/learned list down whenever we have a user —
  // and again on each post-restore auth event (see `sessionEpoch`), since
  // the first attempt on a cold start can quietly return an empty set.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    loadProgress(userId)
      .then((loaded) =>
        // Never let an empty (likely unauthenticated) result blow away a
        // list we already have in hand — a later epoch will refill it.
        setProgress((current) =>
          Object.keys(loaded).length === 0 && Object.keys(current).length > 0
            ? current
            : loaded,
        ),
      )
      .catch((err: any) =>
        setMessage(`Could not load your saved dances: ${err.message}`),
      );
  }, [userId, sessionEpoch]);

  // Hydrate catalogCache from last session's persisted copy, in parallel
  // with loadProgress above rather than waiting on it — so My List can
  // show fully-detailed cards (choreographer, counts, video) immediately
  // for any dance it's already seen recently, instead of every app open
  // showing bare cards for a few seconds while the normal resolver effect
  // re-fetches everything from BootStepper. That resolver still runs
  // exactly as before and overwrites this with fresh data; a dance that
  // isn't cached (or whose cache went stale) just falls back to today's
  // behavior.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadCachedCatalog(userId).then((cached) => {
      if (cancelled || !Object.keys(cached).length) return;
      setCatalogCache((current) => ({ ...cached, ...current }));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Ties this device's RevenueCat customer to the signed-in Supabase user,
  // then keeps `isPremium` live: a real entitlement OR a manual server
  // comp (see subscribeToPremiumStatus). Comping someone ahead of a real
  // subscription is just
  //   update profiles set is_premium = true where id = '<their user id>';
  // — takes effect next time they open the app, no app change needed.
  useEffect(() => {
    if (!userId) return;
    try {
      // Synchronous, and the one call in this whole startup fan-out with
      // no internal try/catch anywhere in its chain (unlike every other
      // RevenueCat wrapper in src/lib/revenuecat.ts) — a native SDK
      // hiccup here shouldn't be able to take down the first-ever render
      // of the authenticated tree just because purchases failed to
      // configure.
      configurePurchases(userId);
    } catch (err) {
      console.warn("[App] configurePurchases failed", err);
    }
    void loginPurchases(userId);
    return subscribeToPremiumStatus(userId, setIsPremium);
  }, [userId]);

  // Keep the offline-notepad badge in step: on load, when connectivity
  // flips, and after the notepad modal closes.
  const refreshOfflineCount = () => {
    if (!userId) return;
    countOfflineList(userId).then(setOfflineCount).catch(() => {});
  };
  useEffect(refreshOfflineCount, [userId, online]);

  const refreshRequestCount = () => {
    if (!userId) return;
    loadFriendRequests()
      .then((requests) =>
        setPendingRequestCount(
          requests.filter((r) => r.direction === "incoming").length,
        ),
      )
      .catch(() => {
        // Non-critical: worst case the Profile tab just has no badge.
      });
  };

  useEffect(refreshRequestCount, [userId, sessionEpoch]);

  const mergeIntoCache = (dances: Dance[]) => {
    if (!dances.length) return;
    setCatalogCache((current) => {
      const next = { ...current };
      for (const dance of dances) {
        // A snapshot (friend import, offline fallback) must never replace a
        // full BootStepper dance we've already resolved.
        const existing = next[dance.id];
        if (existing && !existing.snapshot && dance.snapshot) continue;
        next[dance.id] = dance;
      }
      // Best-effort — persists for next app open's hydration above.
      if (userId) void saveCachedCatalog(userId, next).catch(() => {});
      return next;
    });
  };

  // Debounced search against BootStepper. An empty query asks for their
  // default/relevance ordering, so Home always shows something.
  const searchRequestId = useRef(0);
  useEffect(() => {
    if (!session) return;
    const requestId = ++searchRequestId.current;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      searchDances(query)
        .then((results) => {
          if (searchRequestId.current !== requestId) return; // stale
          setSearchResults(results);
          mergeIntoCache(results);
          setSearchLoading(false);
        })
        .catch((error) => {
          if (searchRequestId.current !== requestId) return;
          setSearchLoading(false);
          setMessage(
            `Could not load dances from BootStepper: ${error.message}`,
          );
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, session]);

  // Resolve dance ids saved in progress that we only have a snapshot for —
  // covers opening straight to "Want to learn" / "Learned" without having
  // searched this session, and dances imported from a friend's list (which
  // arrive as bare name/song/difficulty snapshots). Each id is attempted
  // once per session; a miss just leaves the snapshot in place.
  const resolveAttemptedRef = useRef<Set<string>>(new Set());
  const resolveRetryRef = useRef(0);
  const [resolveTick, setResolveTick] = useState(0);
  useEffect(() => {
    const needIds = Object.keys(progress).filter((id) => {
      if (resolveAttemptedRef.current.has(id)) return false;
      const cached = catalogCache[id];
      return !cached || cached.snapshot;
    });
    if (!needIds.length) return;
    let cancelled = false;
    getDancesByIds(needIds)
      .then((dances) => {
        if (cancelled) return;
        // Mark tried only on success — a transient BootStepper / auth
        // hiccup shouldn't permanently leave a card as a bare snapshot
        // with no choreographer / counts until a full reload.
        needIds.forEach((id) => resolveAttemptedRef.current.add(id));
        resolveRetryRef.current = 0;
        mergeIntoCache(dances);
        // Best-effort: sync each freshly-resolved dance's music links onto
        // its progress row — backfills rows saved before these columns
        // existed, and keeps them current from here on. A failure here
        // shouldn't be user-visible; the live catalogCache copy already has
        // what's needed for this session either way.
        if (userId) {
          dances.forEach((d) => {
            void backfillDanceLinks(userId, d).catch(() => {});
          });
        }
      })
      .catch(() => {
        // Retry a few times, spaced out, then stop hammering.
        if (cancelled || resolveRetryRef.current >= 4) return;
        resolveRetryRef.current += 1;
        setTimeout(() => setResolveTick((n) => n + 1), 15000);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, catalogCache, resolveTick]);

  const progressValues = Object.values(progress);
  const learnedCount = progressValues.filter(
    (p) => p.status === "learned",
  ).length;
  const wantCount = progressValues.filter((p) => p.status === "want").length;

  if (authLoading)
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.safe}>
          <Text style={s.loading}>Loading your dance list…</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  // The reset screen needs the session the recovery link created, so it
  // has to come after the auth check but before everything else.
  if (session && resetPassword)
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.safe}>
          <StatusBar style="light" />
          <ResetPasswordScreen
            email={session.user.email ?? undefined}
            onDone={() => setResetPassword(false)}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  if (!session) return <AuthScreen />;

  const handleProgressChange = (
    danceId: string,
    next: DanceProgress | null,
  ) => {
    setProgress((current) => {
      const updated = { ...current };
      if (next) updated[danceId] = next;
      else delete updated[danceId];
      return updated;
    });
  };

  const openDance = (dance: Dance) => {
    mergeIntoCache([dance]);
    setSelected(dance);
    // Whichever search field (Home, My List, Venues) was focused when the
    // card was tapped shouldn't stay focused with the modal now on top of it.
    Keyboard.dismiss();
  };

  // Home-card quick actions: set a status without opening the modal, or
  // clear it if the tapped status is already the current one. Venue ties
  // aren't touched — those live in the details modal.
  const handleQuickStatus = async (
    dance: Dance,
    status: "want" | "learning" | "learned",
  ) => {
    if (!session) return;
    const isNewAddition = !progress[dance.id];
    if (isNewAddition && reachedDanceLimit(progress, isPremium)) {
      showAlert(DANCE_LIMIT_TITLE, DANCE_LIMIT_MESSAGE);
      return;
    }
    mergeIntoCache([dance]);
    const current = progress[dance.id]?.status;
    try {
      // Tapping the already-active status again deselects it — the dance
      // stays on My List with no status, it doesn't get removed. Removing
      // it entirely is a separate, explicit action (the trash/remove flow).
      const nextStatus: DanceProgress["status"] =
        current === status ? "none" : status;
      // Keep whoever shared this dance attached across every status
      // change (want → learning → learned), so the "Shared from" badge
      // survives. Undefined here means it's the user's own.
      const sharedFrom = progress[dance.id]?.fromFriend;
      // The first time a dance is added (no link yet), seed it from
      // BootStepper's own teach video if it has one — still freely
      // editable from the dance modal afterward. A later status change on
      // an already-added dance just carries the existing link through
      // unchanged, same as before.
      const existingLink = progress[dance.id]?.link;
      const seededLink = existingLink ?? dance.teachVideoUrl;
      const isNewlySeeded = !existingLink && !!seededLink;
      const next: DanceProgress = {
        danceId: dance.id,
        status: nextStatus,
        fromFriend: sharedFrom,
        danceName: dance.name,
        danceSong: dance.defaultSong,
        danceDifficulty: dance.difficulty,
        // saveProgress leaves the link column alone — keep it in local
        // state so the card's video chip survives a quick status change.
        link: seededLink,
        linkSource: isNewlySeeded
          ? "bootstepper"
          : progress[dance.id]?.linkSource,
        // Keep the original "date added" put; only bump "last updated".
        createdAt: progress[dance.id]?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveProgress(session.user.id, next, dance, sharedFrom, {
        overwrite: true,
      });
      // saveProgress never touches `link` (see setDanceLink's own comment
      // on why it's kept separate) — persist the seeded value explicitly,
      // best-effort, only when we actually just seeded something new.
      if (isNewlySeeded) {
        void setDanceLink(
          session.user.id,
          dance.id,
          seededLink!,
          "bootstepper",
        ).catch(() => {});
      }
      handleProgressChange(dance.id, next);
    } catch (err: any) {
      setMessage(`Could not update ${dance.name}: ${err.message}`);
    }
  };

  // Same as handleQuickStatus, but for a dance found on the Venues page —
  // turning a status on also ties it to the venue you found it at, so it
  // shows up in your My List filtered by that venue. Best-effort: a venue
  // hiccup shouldn't undo the status change, and turning a status *off*
  // never untags the venue (that's an explicit action in the dance modal).
  //
  // Deliberately does NOT bump venuesRefreshKey: that key drives a full
  // network re-fetch in whichever screen is watching it, and VenuesScreen
  // is exactly the screen this fires from — bumping it here just reloaded
  // the whole "dances at this venue" list (and its loading spinner) under
  // the user's thumb on every single tap. My List / Profile don't need the
  // nudge either: switching to those tabs remounts them, which re-fetches
  // on its own. The "N people report this here" count catches up next time
  // this venue is (re)loaded.
  const handleQuickStatusAtVenue = async (
    dance: Dance,
    status: "want" | "learning" | "learned",
    venueId: string,
  ) => {
    const wasStatus = progress[dance.id]?.status;
    await handleQuickStatus(dance, status);
    if (wasStatus !== status && session) {
      try {
        await saveVenueDance(session.user.id, venueId, dance, "");
      } catch {
        // non-critical
      }
    }
  };

  const handleRemoved = (danceId: string) => {
    handleProgressChange(danceId, null);

    setVenuesRefreshKey((k) => k + 1);
  };

  // Back online: push every offline-notepad line into the normal import
  // queue, wipe the notepad, and drop the user into the matcher on Profile.
  const handleOfflineImport = async (items: OfflineDance[]) => {
    if (!userId || !items.length) return;
    await queueImport(
      userId,
      items.map((item) => ({
        name: item.note ? `${item.name} — ${item.note}` : item.name,
        checked: false,
      })),
    );
    await clearOfflineList(userId);
    setOfflineCount(0);
    setOfflineOpen(false);
    setOpenImportOnProfile(true);
    setTab("Profile");
  };

  // Removes the given dances from every list + venue. `confirm` is caller
  // text; pass "" to skip the prompt. The list updates immediately and the
  // delete runs in the background — a failure rolls the dances back.
  const removeDances = async (danceIds: string[], confirm: string) => {
    if (!danceIds.length || !session) return;
    if (confirm) {
      const ok = await confirmAction(
        danceIds.length === 1 ? "Remove this dance?" : "Remove these dances?",
        confirm,
        "Remove",
        true,
      );
      if (!ok) return;
    }

    const removed: Record<string, DanceProgress> = {};
    for (const id of danceIds) {
      if (progress[id]) removed[id] = progress[id];
    }

    setProgress((current) => {
      const next = { ...current };
      for (const id of danceIds) delete next[id];
      return next;
    });
    setVenuesRefreshKey((k) => k + 1);

    try {
      await removeDancesEverywhere(session.user.id, danceIds);
    } catch (err: any) {
      setProgress((current) => ({ ...removed, ...current }));
      setVenuesRefreshKey((k) => k + 1);
      showAlert("Could not remove", err.message ?? "Please try again.");
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
        <StatusBar style="light" />
        <View style={s.header}>
          <Pressable
            style={s.infoButton}
            onPress={() => setLegendOpen(true)}
            hitSlop={10}
            accessibilityLabel="What the dance card icons mean"
          >
            <Text style={s.infoIcon}>ⓘ</Text>
          </Pressable>
          <Pressable
            onPress={() => activeScrollRef.current?.scrollToTop()}
            hitSlop={6}
            accessibilityLabel="Back to top"
          >
            <Image
              source={require("./assets/no_circle_logo-dark.png")}
              style={s.logo}
              resizeMode="contain"
            />
          </Pressable>
          <Pressable
            style={s.infoButton}
            onPress={() => setHelpOpen(true)}
            hitSlop={10}
            accessibilityLabel="Where to find things"
          >
            <Text style={s.infoIcon}>?</Text>
          </Pressable>
        </View>
        <OfflineBanner
          online={online}
          pendingCount={offlineCount}
          onPress={() => setOfflineOpen(true)}
        />
        <KeyboardAvoidingView
          style={s.tabContent}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        {tab === "Profile" ? (
          // Scoped to just this tab, not the whole app — mounting the
          // native Apple Music provider eagerly for every screen meant it
          // did native init work the instant someone signed in, before
          // they'd ever touched Profile. Suspected cause of a black
          // screen right after a fresh install's first login (works fine
          // on relaunch, once the OS has already initialized MusicKit for
          // this app once).
          <AppleMusicProviderGate developerToken={appleDeveloperToken}>
            <ProfileScreen
              userId={session.user.id}
              email={session.user.is_anonymous ? undefined : session.user.email}
              learnedCount={learnedCount}
              wantCount={wantCount}
              progress={progress}
              onProgressChange={handleProgressChange}
              onCacheDances={mergeIntoCache}
              openImport={openImportOnProfile}
              onImportHandled={() => setOpenImportOnProfile(false)}
              onOpenOfflineList={() => setOfflineOpen(true)}
              onSignOut={() => void supabase.auth.signOut()}
              onVenuesChanged={() => setVenuesRefreshKey((k) => k + 1)}
              isPremium={isPremium}
              musicRefreshKey={musicRefreshKey}
              onMusicChanged={() => setMusicRefreshKey((k) => k + 1)}
            />
          </AppleMusicProviderGate>
        ) : tab === "My List" ? (
          <MyListScreen
            userId={session.user.id}
            progress={progress}
            catalogCache={catalogCache}
            onOpenDance={openDance}
            onQuickStatus={handleQuickStatus}
            onRemoveDances={(ids) => removeDances(ids, "")}
            refreshKey={venuesRefreshKey}
            scrollRef={activeScrollRef}
            isPremium={isPremium}
            onVenuesChanged={() => setVenuesRefreshKey((k) => k + 1)}
            musicRefreshKey={musicRefreshKey}
            onMusicChanged={() => setMusicRefreshKey((k) => k + 1)}
          />
        ) : tab === "Venues" ? (
          isPremium ? (
            <VenuesScreen
              userId={session.user.id}
              progress={progress}
              catalogCache={catalogCache}
              onOpenDance={openDance}
              onQuickStatusAtVenue={handleQuickStatusAtVenue}
              onCacheDances={mergeIntoCache}
              refreshKey={venuesRefreshKey}
              scrollRef={activeScrollRef}
            />
          ) : (
            <PaywallScreen
              title="Venues"
              bullets={[
                "Browse every venue in the shared catalog",
                "See which dances people report dancing there",
                "Set a home bar, pinned to the top everywhere",
                "Endorse a venue so others know it's the real deal",
              ]}
            />
          )
        ) : tab === "Friends" ? (
          isPremium ? (
            <FriendsScreen
              userId={session.user.id}
              email={session.user.is_anonymous ? undefined : session.user.email}
              progress={progress}
              onProgressChange={handleProgressChange}
              onOpenDance={openDance}
              onPendingRequestCountChange={setPendingRequestCount}
              isPremium={isPremium}
              scrollRef={activeScrollRef}
            />
          ) : (
            <PaywallScreen
              title="Friends"
              bullets={[
                "See what your friends just learned or added",
                "Get notified when a friend adds a new venue",
                "Plan a night out — make an event, everyone RSVPs",
                "Import dances straight from a friend's list",
              ]}
            />
          )
        ) : (
          <BackToTopScrollView
            ref={activeScrollRef}
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.greeting}>Find your next favorite step ✨</Text>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search dances or songs"
              style={s.search}
            />
            <Text style={s.section}>DANCES</Text>
            {searchLoading && !searchResults.length && (
              <Text style={s.empty}>Loading dances…</Text>
            )}
            {searchResults.map((d) => (
              <DanceCard
                key={d.id}
                dance={d}
                song={d.defaultSong}
                progress={progress[d.id]}
                onPress={() => openDance(d)}
                onQuickStatus={(status) => handleQuickStatus(d, status)}
              />
            ))}
            {!searchLoading && !searchResults.length && (
              <Text style={s.empty}>
                No dances found — try a different search.
              </Text>
            )}
            {message ? <Text style={s.message}>{message}</Text> : null}
          </BackToTopScrollView>
        )}
        </KeyboardAvoidingView>
        <BottomTabs
          activeTab={tab}
          onChange={setTab}
          badges={{ Friends: pendingRequestCount }}
        />
        <StatusLegendModal
          visible={legendOpen}
          onClose={() => setLegendOpen(false)}
        />
        <HelpModal visible={helpOpen} onClose={() => setHelpOpen(false)} />
        <DanceDetailsModal
          dance={selected ? (catalogCache[selected.id] ?? selected) : null}
          userId={session.user.id}
          activeTab={tab}
          progress={selected ? progress[selected.id] : undefined}
          onClose={() => {
            setSelected(null);
            // Closing the modal shouldn't leave whichever search field (Home,
            // My List, Venues) opened it still focused with the keyboard up.
            Keyboard.dismiss();
          }}
          onProgressChange={handleProgressChange}
          onRemoved={handleRemoved}
          onVenuesChanged={() => setVenuesRefreshKey((k) => k + 1)}
          isPremium={isPremium}
          atDanceLimit={
            selected ? reachedDanceLimit(progress, isPremium) : false
          }
        />
        <OfflineListModal
          visible={offlineOpen}
          online={online}
          userId={session.user.id}
          onClose={() => {
            setOfflineOpen(false);
            refreshOfflineCount();
          }}
          onImport={handleOfflineImport}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: {
    color: colors.ink,
    textAlign: "center",
    marginTop: 100,
    fontSize: 16,
  },
  tabContent: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  infoButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  infoIcon: { color: colors.gold, fontSize: 20, fontWeight: "700" },
  logo: {
    width: 96,
    height: 64,
  },
  content: { padding: 20, paddingBottom: 110 },
  greeting: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "700",
    marginBottom: 18,
  },
  search: {
    backgroundColor: colors.card,
    color: colors.ink,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 24,
    marginBottom: 8,
  },
  empty: { color: colors.muted, fontSize: 15, marginTop: 10 },
  message: {
    color: colors.green,
    textAlign: "center",
    marginTop: 15,
    fontWeight: "700",
  },
});
