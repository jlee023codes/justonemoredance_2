import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
const awards = [
  { count: 1, icon: "🌟", title: "First Steps", note: "Learn 1 dance" },
  { count: 5, icon: "✨", title: "Dance Regular", note: "Learn 5 dances" },
  {
    count: 10,
    icon: "🏆",
    title: "Dance Floor Legend",
    note: "Learn 10 dances",
  },
  { count: 25, icon: "👑", title: "Headliner", note: "Learn 25 dances" },
];
export function ProfileScreen({
  email,
  learnedCount,
  wantCount,
  onSignOut,
}: {
  email?: string;
  learnedCount: number;
  wantCount: number;
  onSignOut: () => void;
}) {
  const next = awards.find((award) => award.count > learnedCount);
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.heading}>Your dance journey</Text>
      <View style={s.hero}>
        <Text style={s.number}>{learnedCount}</Text>
        <View>
          <Text style={s.heroTitle}>dances learned</Text>
          <Text style={s.heroNote}>
            {next
              ? `${next.count - learnedCount} more to unlock ${next.title}`
              : "Every award unlocked — amazing!"}
          </Text>
        </View>
      </View>
      <Text style={s.section}>AWARDS</Text>
      {awards.map((award) => {
        const unlocked = learnedCount >= award.count;
        return (
          <View
            key={award.title}
            style={[s.award, unlocked && s.awardUnlocked]}
          >
            <Text style={s.awardIcon}>{award.icon}</Text>
            <View style={s.awardCopy}>
              <Text style={[s.awardTitle, unlocked && s.unlockedText]}>
                {award.title}
              </Text>
              <Text style={s.awardNote}>{award.note}</Text>
            </View>
            <Text style={s.status}>
              {unlocked ? "UNLOCKED" : `${learnedCount}/${award.count}`}
            </Text>
          </View>
        );
      })}
      <Text style={s.section}>PROGRESS</Text>
      <View style={s.statRow}>
        <Text style={s.statLabel}>Want to learn</Text>
        <Text style={s.statValue}>{wantCount}</Text>
      </View>
      <Text style={s.section}>SETTINGS</Text>
      <View style={s.settings}>
        <Text style={s.settingLabel}>SIGNED IN AS</Text>
        <Text style={s.email}>{email ?? "Guest dancer"}</Text>
        <Pressable style={s.signOut} onPress={onSignOut}>
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  heading: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    marginBottom: 18,
  },
  hero: {
    backgroundColor: "#393028",
    borderWidth: 1,
    borderColor: "#6c5630",
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  number: {
    color: colors.gold,
    fontSize: 44,
    fontWeight: "900",
    marginRight: 14,
  },
  heroTitle: { color: colors.ink, fontWeight: "800", fontSize: 17 },
  heroNote: { color: colors.muted, fontSize: 12, marginTop: 4 },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 25,
    marginBottom: 8,
  },
  award: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 13,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
    opacity: 0.55,
  },
  awardUnlocked: { opacity: 1, borderWidth: 1, borderColor: "#6c5630" },
  awardIcon: { fontSize: 25, width: 42 },
  awardCopy: { flex: 1 },
  awardTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  unlockedText: { color: colors.gold },
  awardNote: { color: colors.muted, fontSize: 12, marginTop: 3 },
  status: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  statRow: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 15,
    flexDirection: "row",
  },
  statLabel: { color: colors.ink, fontSize: 16, flex: 1 },
  statValue: { color: colors.pink, fontSize: 18, fontWeight: "900" },
  settings: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
  settingLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  email: { color: colors.ink, fontSize: 15, marginTop: 5 },
  signOut: {
    marginTop: 17,
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  signOutText: { color: colors.pink, fontWeight: "800" },
});
