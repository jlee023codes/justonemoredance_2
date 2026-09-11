import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { showAlert } from "../lib/alerts";

/** Shown in place of a premium screen's real content. There's no real
 *  RevenueCat integration yet (see src/lib/entitlements.ts), so "Upgrade"
 *  just explains that — this is the seam where a real purchase flow
 *  would hook in. */
export function PaywallScreen({
  title,
  bullets,
}: {
  title: string;
  bullets: string[];
}) {
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.icon}>🔒</Text>
      <Text style={s.title}>{title} is a Premium feature</Text>
      <View style={s.card}>
        {bullets.map((b) => (
          <View key={b} style={s.bulletRow}>
            <Text style={s.bulletDot}>•</Text>
            <Text style={s.bulletText}>{b}</Text>
          </View>
        ))}
      </View>
      <Pressable
        style={s.upgrade}
        onPress={() =>
          showAlert(
            "Coming soon",
            "Just One More Dance subscriptions aren't live yet — check back soon!",
          )
        }
      >
        <Text style={s.upgradeText}>✨ Upgrade to Premium</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 24, paddingTop: 60, alignItems: "center" },
  icon: { fontSize: 40, marginBottom: 14 },
  title: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    width: "100%",
    marginBottom: 24,
  },
  bulletRow: { flexDirection: "row", marginBottom: 10 },
  bulletDot: { color: colors.gold, fontSize: 15, marginRight: 8 },
  bulletText: { color: colors.ink, fontSize: 14, flex: 1, lineHeight: 20 },
  upgrade: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    paddingVertical: 15,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  upgradeText: { color: "#fff", fontWeight: "900", fontSize: 15 },
});
