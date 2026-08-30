import { useEffect, useState } from "react";
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
import { dances, venues } from "./src/data";
import { Dance, DanceProgress, LearningStatus } from "./src/types";
import { AppTab, BottomTabs } from "./src/components/BottomTabs";
import { DanceCard } from "./src/components/DanceCard";
import {
  DanceDetailsModal,
  DanceEntry,
} from "./src/components/DanceDetailsModal";
import { VenuePicker } from "./src/components/VenuePicker";
import { colors } from "./src/styles";
import { AuthScreen } from "./src/components/AuthScreen";
import { ProfileScreen } from "./src/components/ProfileScreen";
import { supabase } from "./src/lib/supabase";
import { loadProgress, saveProgress } from "./src/services/progress";
import { Session } from "@supabase/supabase-js";
// A received dance is deliberately separate from the app's reference catalog.
const sampleFriendDance: Dance = {
  id: "friends-two-step",
  name: "Friends Two-Step",
  defaultSong: "Neon Moon — Brooks & Dunn",
  difficulty: "Beginner",
  details: "32 count • 4 wall • shared by a friend",
  venueSongs: [],
  songSwaps: [],
};

export default function App() {
  const [tab, setTab] = useState<AppTab>("Home"),
    [venueId, setVenueId] = useState("anywhere"),
    [query, setQuery] = useState(""),
    [progress, setProgress] = useState<Record<string, DanceProgress>>({}),
    [receivedDances, setReceivedDances] = useState<Dance[]>([]),
    [selected, setSelected] = useState<Dance | null>(null),
    [picker, setPicker] = useState(false),
    [share, setShare] = useState(false),
    [message, setMessage] = useState(""),
    [session, setSession] = useState<Session | null>(null),
    [authLoading, setAuthLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    loadProgress(session.user.id).then(setProgress).catch((error) => setMessage(`Could not load saved dances: ${error.message}`));
  }, [session]);
  const venueName = venues.find((v) => v.id === venueId)?.name ?? "Everywhere";
  const learnedCount = Object.values(progress).filter(
    (p) => p.status === "learned",
  ).length;
  // The Home catalog is always the original dance data. Learning and friend lists may include received dances.
  const learningCatalog = [...dances, ...receivedDances];
  const want = learningCatalog.filter((d) => progress[d.id]?.status === "want"),
    learned = learningCatalog.filter((d) => progress[d.id]?.status === "learned"),
    friends = want.filter((d) => progress[d.id]?.fromFriend);
  const filtered = dances.filter((dance) => {
    const matchesVenue = venueId === "anywhere" || dance.venueSongs.some((song) => song.venueId === venueId);
    const matchesSearch = (dance.name + " " + dance.defaultSong).toLowerCase().includes(query.toLowerCase());
    return matchesVenue && matchesSearch;
  });
  const songFor = (d: Dance) =>
    d.venueSongs.find((v) => v.venueId === venueId)?.song ?? d.defaultSong;
  if (authLoading) return <SafeAreaView style={s.safe}><Text style={s.loading}>Loading your dance list…</Text></SafeAreaView>;
  if (!session) return <AuthScreen />;
  const save = (dance: Dance, status: LearningStatus, entry: DanceEntry) => {
    const next: DanceProgress = { danceId: dance.id, status, personalVenueId: entry.venueId === "anywhere" ? undefined : entry.venueId, personalSongSwap: entry.songSwap || undefined, fromFriend: progress[dance.id]?.fromFriend };
    setProgress((current) => ({ ...current, [dance.id]: next }));
    void saveProgress(session.user.id, next).catch((error) => setMessage(`Could not save your dance: ${error.message}`));
    setSelected(null);
  };
  const receive = () => {
    // Domino is already in the reference catalog, so it is an overlap—not a friend-only dance.
    // A real backend would merge any new song swaps for that dance here.
    const incoming = [dances[2], sampleFriendDance];
    const catalogIds = new Set(dances.map((dance) => dance.id));
    const friendOnly = incoming.filter((dance) => !catalogIds.has(dance.id));
    setReceivedDances((current) => [...current, ...friendOnly.filter((dance) => !current.some((item) => item.id === dance.id))]);
    setProgress((current) => ({
      ...current,
      ...Object.fromEntries(friendOnly.filter((dance) => !current[dance.id]).map((dance) => [dance.id, { danceId: dance.id, status: "want" as const, fromFriend: true }])),
    }));
    setShare(false);
    setMessage("List merged — Domino already exists in your catalog; Friends Two-Step was added under “From friends”.");
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
      ) : tab === "Home" ? (
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.greeting}>Find your next favorite step ✨</Text>
          <Pressable style={s.venue} onPress={() => setPicker(true)}>
            <Text style={s.venueLabel}>VENUE</Text>
            <Text style={s.venueValue}>{venueName} ▾</Text>
          </Pressable>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search dances or songs"
            placeholderTextColor={colors.muted}
            style={s.search}
          />
          <Text style={s.section}>DANCES</Text>
          {filtered.map((d) => (
            <DanceCard
              key={d.id}
              dance={d}
              song={songFor(d)}
              progress={progress[d.id]}
              onPress={() => setSelected(d)}
            />
          ))}
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
                  song={songFor(d)}
                  progress={progress[d.id]}
                  onPress={() => setSelected(d)}
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
                song={songFor(d)}
                progress={progress[d.id]}
                onPress={() => setSelected(d)}
              />
            ))}
          {!list.length && (
            <Text style={s.empty}>
              Nothing here yet — choose a dance from Ho me.
            </Text>
          )}
        </ScrollView>
      )}
      <BottomTabs activeTab={tab} onChange={setTab} />
      <VenuePicker
        visible={picker}
        title="Choose a venue"
        selectedVenueId={venueId}
        onSelect={(id) => {
          setVenueId(id);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
      <DanceDetailsModal
        dance={selected}
        defaultVenueId={venueId}
        progress={selected ? progress[selected.id] : undefined}
        onClose={() => setSelected(null)}
        onSave={save}
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
  loading: { color: colors.ink, textAlign: "center", marginTop: 100, fontSize: 16 },
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
  venue: {
    backgroundColor: "#33243f",
    borderRadius: 12,
    padding: 14,
    marginBottom: 13,
  },
  venueLabel: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  venueValue: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 3,
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
