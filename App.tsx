import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Dance, DanceProgress, LearningStatus } from "./src/types";
import { AppTab, BottomTabs } from "./src/components/BottomTabs";
import { DanceCard } from "./src/components/DanceCard";
import { DanceDetailsModal } from "./src/components/DanceDetailsModal";
import { MyVenuesScreen } from "./src/components/MyVenuesScreen";
import { colors } from "./src/styles";
import { AuthScreen } from "./src/components/AuthScreen";
import { ProfileScreen } from "./src/components/ProfileScreen";
import { supabase } from "./src/lib/supabase";
import { loadProgress } from "./src/services/progress";
import { searchDances, getDancesByIds } from "./src/lib/bootstepper";
import { Session } from "@supabase/supabase-js";

// A received dance is deliberately separate from the app's BootStepper-backed catalog.
const sampleFriendDance: Dance = {
  id: "friends-two-step",
  name: "Friends Two-Step",
  defaultSong: "Neon Moon — Brooks & Dunn",
  difficulty: "Beginner",
  details: "32 count • 4 wall • shared by a friend",
  venueSongs: [],
  songSwaps: [],
};

// Falls back to whatever was snapshotted at save time if a dance can't be
// resolved from BootStepper right now (offline, removed upstream, etc).
function danceFromProgress(progress: DanceProgress): Dance {
  return {
    id: progress.danceId,
    name: progress.danceName ?? "Dance",
    defaultSong: progress.danceSong ?? "",
    difficulty: progress.danceDifficulty ?? "Beginner",
    details: "",
    venueSongs: [],
    songSwaps: [],
  };
}

export default function App() {
  const [tab, setTab] = useState<AppTab>("Home"),
    [query, setQuery] = useState(""),
    [progress, setProgress] = useState<Record<string, DanceProgress>>({}),
    [receivedDances, setReceivedDances] = useState<Dance[]>([]),
    [selected, setSelected] = useState<Dance | null>(null),
    [share, setShare] = useState(false),
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
    [venuesRefreshKey, setVenuesRefreshKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => setSession(nextSession),
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    loadProgress(session.user.id)
      .then(setProgress)
      .catch((error) =>
        setMessage(`Could not load saved dances: ${error.message}`),
      );
  }, [session]);

  const mergeIntoCache = (dances: Dance[]) => {
    if (!dances.length) return;
    setCatalogCache((current) => {
      const next = { ...current };
      for (const dance of dances) next[dance.id] = dance;
      return next;
    });
  };

  useEffect(() => {
    mergeIntoCache(receivedDances);
  }, [receivedDances]);

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
          setMessage(`Could not load dances from BootStepper: ${error.message}`);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, session]);

  // Resolve any dance ids saved in progress that aren't already cached —
  // covers opening straight to "Want to learn" / "Learned" without having
  // searched for those dances first in this session.
  useEffect(() => {
    const missingIds = Object.keys(progress).filter(
      (id) => !catalogCache[id] && !receivedDances.some((d) => d.id === id),
    );
    if (!missingIds.length) return;
    getDancesByIds(missingIds)
      .then(mergeIntoCache)
      .catch(() => {
        // Silently fall back to the progress snapshot — see danceFromProgress.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, catalogCache, receivedDances]);

  const resolveDance = (id: string): Dance =>
    catalogCache[id] ??
    receivedDances.find((d) => d.id === id) ??
    danceFromProgress(progress[id]);

  const learnedCount = Object.values(progress).filter(
    (p) => p.status === "learned",
  ).length;
  const want = Object.values(progress)
      .filter((p) => p.status === "want")
      .map((p) => resolveDance(p.danceId)),
    learned = Object.values(progress)
      .filter((p) => p.status === "learned")
      .map((p) => resolveDance(p.danceId)),
    friends = want.filter((d) => progress[d.id]?.fromFriend);

  if (authLoading)
    return (
      <SafeAreaView style={s.safe}>
        <Text style={s.loading}>Loading your dance list…</Text>
      </SafeAreaView>
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

  const handleRemoved = (danceId: string) => {
    handleProgressChange(danceId, null);
    
    setVenuesRefreshKey((k) => k + 1);
  };

  const receive = () => {
    // Demo/sample data for the "share my list" flow. Uses whatever's
    // currently in the Home search results as a stand-in "you already have
    // this one" example, since the catalog is no longer a fixed local list.
    const overlap = searchResults[0];
    const incoming = overlap ? [overlap, sampleFriendDance] : [sampleFriendDance];
    const alreadyOwned = new Set(
      Object.keys(progress).filter((id) => !progress[id]?.fromFriend),
    );
    const friendOnly = incoming.filter((dance) => !alreadyOwned.has(dance.id));
    mergeIntoCache(friendOnly);
    setReceivedDances((current) => [
      ...current,
      ...friendOnly.filter(
        (dance) => !current.some((item) => item.id === dance.id),
      ),
    ]);
    setProgress((current) => {
      const next = { ...current };
      for (const dance of friendOnly) {
        if (!next[dance.id]) {
          next[dance.id] = {
            danceId: dance.id,
            status: "want",
            fromFriend: true,
            danceName: dance.name,
            danceSong: dance.defaultSong,
            danceDifficulty: dance.difficulty,
          };
        }
      }
      return next;
    });
    setShare(false);
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
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Text style={s.logo}>JUST ONE MORE</Text>
        <Text style={s.dance}>DANCE</Text>
      </View>
      {tab === "Profile" ? (
        <ProfileScreen
          email={session.user.is_anonymous ? undefined : session.user.email}
          learnedCount={learnedCount}
          wantCount={want.length}
          onSignOut={() => void supabase.auth.signOut()}
        />
      ) : tab === "My Venues" ? (
        <MyVenuesScreen
          userId={session.user.id}
          progress={progress}
          onOpenDance={openDance}
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
            />
          ))}
          {!searchLoading && !searchResults.length && (
            <Text style={s.empty}>No dances found — try a different search.</Text>
          )}
          <Pressable style={s.share} onPress={() => setShare(true)}>
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
          {tab === "Want to learn" && friends.length > 0 && (
            <>
              <Text style={s.section}>FROM FRIENDS</Text>
              {friends.map((d) => (
                <DanceCard
                  key={d.id}
                  dance={d}
                  song={d.defaultSong}
                  progress={progress[d.id]}
                  onPress={() => openDance(d)}
                />
              ))}
            </>
          )}
          <Text style={s.section}>
            {tab === "Want to learn" ? "MY LIST" : "LEARNED"}
          </Text>
          {list
            .filter(
              (d) => tab !== "Want to learn" || !progress[d.id]?.fromFriend,
            )
            .map((d) => (
              <DanceCard
                key={d.id}
                dance={d}
                song={d.defaultSong}
                progress={progress[d.id]}
                onPress={() => openDance(d)}
              />
            ))}
          {!list.length && (
            <Text style={s.empty}>
              Nothing here yet — choose a dance from Home.
            </Text>
          )}
        </ScrollView>
      )}
      <BottomTabs activeTab={tab} onChange={setTab} />
      <DanceDetailsModal
        dance={selected}
        userId={session.user.id}
        activeTab={tab}
        progress={selected ? progress[selected.id] : undefined}
        onClose={() => setSelected(null)}
        onProgressChange={handleProgressChange}
        onRemoved={handleRemoved}
      />
      <Modal visible={share} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Share my list</Text>
            <Text style={s.body}>
              Shared dances retain song swaps. Dances your friend does not have
              will appear in their “From friends” list.
            </Text>
            <Pressable style={s.primary} onPress={receive}>
              <Text style={s.primaryText}>Try a sample shared list</Text>
            </Pressable>
            <Pressable onPress={() => setShare(false)}>
              <Text style={s.cancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  overlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 25,
    paddingBottom: 40,
  },
  sheetTitle: { color: colors.ink, fontSize: 27, fontWeight: "900" },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginVertical: 18,
  },
  primary: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 12,
  },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  cancel: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 19,
  },
});
