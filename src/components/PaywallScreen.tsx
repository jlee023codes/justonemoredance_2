import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { showAlert } from "../lib/alerts";
import { presentPaywall } from "../lib/entitlements";

/** Shown in place of a premium screen's real content. "Upgrade" presents
 *  RevenueCat's dashboard-configured Paywall (see REVENUECAT_SETUP.md for
 *  setting one up); on iOS/Android it's the real purchase flow. On web
 *  it's a no-op with a message, since react-native-purchases doesn't run
 *  there — see src/lib/revenuecat.web.ts.
 *
 *  A successful purchase/restore doesn't need any handling here: it fires
 *  RevenueCat's customer-info listener, which App.tsx is already
 *  subscribed to (subscribeToPremiumStatus) — `isPremium` flips and this
 *  screen gets swapped out for the real one automatically. */
export function PaywallScreen({
  title,
  bullets,
}: {
  title: string;
  bullets: string[];
}) {
  const [presenting, setPresenting] = useState(false);

  const handleUpgrade = async () => {
    setPresenting(true);
    try {
      const result = await presentPaywall();
      if (result === "purchased" || result === "restored") {
        showAlert("You're in! 🎉", `Premium is unlocked — enjoy ${title}.`);
      } else if (result === "error") {
        showAlert(
          "Something went wrong",
          "Could not load the paywall. Check your connection and try again.",
        );
      }
      // "cancelled" / "not_presented": nothing to say, they backed out or
      // already have the entitlement (the latter shouldn't happen here
      // since this screen only shows when isPremium is false).
    } finally {
      setPresenting(false);
    }
  };

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
        style={[s.upgrade, presenting && s.upgradeDisabled]}
        onPress={handleUpgrade}
        disabled={presenting}
      >
        <Text style={s.upgradeText}>
          {presenting ? "Loading…" : "✨ Upgrade to Premium"}
        </Text>
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
  upgradeDisabled: { opacity: 0.6 },
  upgradeText: { color: "#fff", fontWeight: "900", fontSize: 15 },
});
