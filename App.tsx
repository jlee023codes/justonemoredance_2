import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { Dance, DanceProgress } from "./src/types";
import { AppTab, BottomTabs } from "./src/components/BottomTabs";
import { DanceCard } from "./src/components/DanceCard";
import { DanceDetailsModal } from "./src/components/DanceDetailsModal";
import { MyVenuesScreen } from "./src/components/MyVenuesScreen";
import { colors } from "./src/styles";
import { AuthScreen } from "./src/components/AuthScreen";
import { ProfileScreen } from "./src/components/ProfileScreen";
import { ResetPasswordScreen } from "./src/components/ResetPasswordScreen";
import { supabase } from "./src/lib/supabase";
import { showAlert } from "./src/lib/alerts";
import {
  applyRecoveryLink,
  clearRecoveryLinkFromUrl,
  parseRecoveryLink,
} from "./src/lib/authLinks";
import {
  loadProgress,
  saveProgress,
  deleteProgress,
} from "./src/services/progress";
import { loadFriendRequests } from "./src/services/friends";
import { searchDances, getDancesByIds } from "./src/lib/bootstepper";
import { Session } from "@supabase/supabase-js";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// Falls back to whatever was snapshotted at save time if a dance can't be
// resolved from BootStepper right now (offline, removed upstream, etc).
function danceFromProgress(progress: DanceProgress): Dance {
  return {
    id: progress.danceId,
    name: progress.danceName ?? "Dance",
    defaultSong: progress.danceSong ?? "",
    difficulty: progress.danceDifficulty ?? "Beginner",
    details: "",
    songSwaps: [],
    snapshot: true,
  };
}

export default function App() {
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
    // True once a password-reset link has been turned into a session and
    // we owe the user a "pick a new password" screen.
    [resetPassword, setResetPassword] = useState(false),
    [pendingRequestCount, setPendingRequestCount] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
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

  // Pull the saved want/learned/maybe list down whenever we have a user.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    loadProgress(userId)
      .then(setProgress)
      .catch((err: any) =>
        setMessage(`Could not load your saved dances: ${err.message}`),
      );
  }, [userId]);

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

  useEffect(refreshRequestCount, [userId]);

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
  useEffect(() => {
    const needIds = Object.keys(progress).filter((id) => {
      if (resolveAttemptedRef.current.has(id)) return false;
      const cached = catalogCache[id];
      return !cached || cached.snapshot;
    });
    if (!needIds.length) return;
    needIds.forEach((id) => resolveAttemptedRef.current.add(id));
    getDancesByIds(needIds)
      .then(mergeIntoCache)
      .catch(() => {
        // Silently fall back to the progress snapshot — see danceFromProgress.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, catalogCache]);

  const resolveDance = (id: string): Dance =>
    catalogCache[id] ?? danceFromProgress(progress[id]);

  const learnedCount = Object.values(progress).filter(
    (p) => p.status === "learned",
  ).length;
  const want = Object.values(progress)
      .filter((p) => p.status === "want")
      .map((p) => resolveDance(p.danceId)),
    learned = Object.values(progress)
      .filter((p) => p.status === "learned")
      .map((p) => resolveDance(p.danceId));

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
  };

  // Home-card quick actions: set a status without opening the modal, or
  // clear it if the tapped status is already the current one. Venue ties
  // aren't touched — those live in the details modal.
  const handleQuickStatus = async (
    dance: Dance,
    status: "maybe" | "want" | "learned",
  ) => {
    if (!session) return;
    mergeIntoCache([dance]);
    const current = progress[dance.id]?.status;
    try {
      if (current === status) {
        await deleteProgress(session.user.id, dance.id);
        handleProgressChange(dance.id, null);
      } else {
        // Keep whoever shared this dance attached across every status
        // change (maybe → want → learned), so the "Shared from" badge
        // survives. Undefined here means it's the user's own.
        const sharedFrom = progress[dance.id]?.fromFriend;
        const next: DanceProgress = {
          danceId: dance.id,
          status,
          fromFriend: sharedFrom,
          danceName: dance.name,
          danceSong: dance.defaultSong,
          danceDifficulty: dance.difficulty,
        };
        await saveProgress(session.user.id, next, dance, sharedFrom, {
          overwrite: true,
        });
        handleProgressChange(dance.id, next);
      }
    } catch (err: any) {
      setMessage(`Could not update ${dance.name}: ${err.message}`);
    }
  };

  const handleRemoved = (danceId: string) => {
    handleProgressChange(danceId, null);

    setVenuesRefreshKey((k) => k + 1);
  };

  const list = tab === "Want to learn" ? want : learned;
  const achievement =
    learnedCount >= 10
      ? "🏆 Dance floor legend"
      : learnedCount >= 5
        ? "✨ High-five: 5 dances learned!"
        : learnedCount
          ? "🌟 First dance down!"
          : "💃 Learn your first dance to unlock a milestone";

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
        <StatusBar style="light" />
        <View style={s.header}>
          <Text style={s.logo}>JUST ONE MORE</Text>
          <Text style={s.dance}>DANCE</Text>
        </View>
        {tab === "Profile" ? (
          <ProfileScreen
            userId={session.user.id}
            email={session.user.is_anonymous ? undefined : session.user.email}
            learnedCount={learnedCount}
            wantCount={want.length}
            progress={progress}
            onProgressChange={handleProgressChange}
            onCacheDances={mergeIntoCache}
            onSignOut={() => void supabase.auth.signOut()}
            onPendingRequestCountChange={setPendingRequestCount}
          />
        ) : tab === "My List" ? (
          <MyVenuesScreen
            userId={session.user.id}
            progress={progress}
            onOpenDance={openDance}
            onQuickStatus={handleQuickStatus}
            refreshKey={venuesRefreshKey}
          />
        ) : tab === "Home" ? (
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.greeting}>Find your next favorite step ✨</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search dances or songs"
              placeholderTextColor={colors.muted}
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
            <Pressable style={s.share} onPress={() => setTab("Profile")}>
              <Text style={s.shareText}>↗ SHARE MY LIST</Text>
            </Pressable>
            {message ? <Text style={s.message}>{message}</Text> : null}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={s.content}>
            <Text style={s.greeting}>
              {tab === "Learned"
                ? learnedCount + " dances in your pocket"
                : "Your next moves, queued up"}
            </Text>
            {tab === "Learned" && (
              <View style={s.achievement}>
                <Text style={s.achievementText}>{achievement}</Text>
                <Text style={s.tiny}>Next milestone: 5 dances</Text>
              </View>
            )}

            <Text style={s.section}>
              {tab === "Want to learn" ? "MY LIST" : "LEARNED"}
            </Text>
            {list
              .map((d) => (
                <DanceCard
                  key={d.id}
                  dance={d}
                  song={d.defaultSong}
                  progress={progress[d.id]}
                  onPress={() => openDance(d)}
                  onQuickStatus={(status) => handleQuickStatus(d, status)}
                  quickActions={
                    tab === "Want to learn"
                      ? [{ status: "learned", icon: "★", label: "Learned it" }]
                      : [{ status: "want", icon: "🔁", label: "Review" }]
                  }
                />
              ))}
            {!list.length && (
              <Text style={s.empty}>
                Nothing here yet — choose a dance from Home.
              </Text>
            )}
          </ScrollView>
        )}
        <BottomTabs
          activeTab={tab}
          onChange={setTab}
          badges={{ Profile: pendingRequestCount }}
        />
        <DanceDetailsModal
          dance={
            selected ? (catalogCache[selected.id] ?? selected) : null
          }
          userId={session.user.id}
          activeTab={tab}
          progress={selected ? progress[selected.id] : undefined}
          onClose={() => setSelected(null)}
          onProgressChange={handleProgressChange}
          onRemoved={handleRemoved}
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
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 10 },
  logo: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3,
  },
  dance: {
    color: colors.ink,
    fontSize: 29,
    fontWeight: "900",
    letterSpacing: 5,
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
  share: {
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 18,
  },
  shareText: { color: colors.pink, fontWeight: "800", letterSpacing: 1 },
  achievement: {
    backgroundColor: "#393028",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#6c5630",
  },
  achievementText: { color: colors.gold, fontWeight: "800", fontSize: 16 },
  tiny: { color: colors.muted, fontSize: 12, marginTop: 5 },
  empty: { color: colors.muted, fontSize: 15, marginTop: 10 },
  message: {
    color: colors.green,
    textAlign: "center",
    marginTop: 15,
    fontWeight: "700",
  },
});
