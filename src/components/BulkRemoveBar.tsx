import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";

/** The outlined pill that turns a list into select mode. */
export function SelectModeButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={s.toggle} onPress={onPress} hitSlop={6}>
      <Text style={s.toggleIcon}>☑</Text>
      <Text style={s.toggleText}>Select</Text>
    </Pressable>
  );
}

/** Floating action bar shown while selecting — stays put as the list
 *  scrolls. Two things you can do with a selection: tag them all to a
 *  venue, or remove them all. */
export function BulkActionBar({
  count,
  onAddToVenue,
  onRemove,
  onCancel,
}: {
  count: number;
  onAddToVenue: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={s.bar}>
      <Pressable style={s.cancel} onPress={onCancel} hitSlop={8}>
        <Text style={s.cancelText}>Cancel</Text>
      </Pressable>
      <Pressable
        style={[s.venueButton, !count && s.actionOff]}
        onPress={onAddToVenue}
        disabled={!count}
      >
        <Text style={s.venueButtonText} numberOfLines={1}>
          📍 Add to venue
        </Text>
      </Pressable>
      <Pressable
        style={[s.remove, !count && s.actionOff]}
        onPress={onRemove}
        disabled={!count}
      >
        <Text style={s.removeText} numberOfLines={1}>
          {count ? `🗑 Remove ${count}` : "🗑 Remove"}
        </Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  toggleIcon: { fontSize: 12, color: colors.pink },
  toggleText: {
    color: colors.pink,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.3,
  },
  bar: {
    position: "absolute",
    left: 12,
    right: 12,
    // Clears the bottom tab bar (see BottomTabs — paddingTop 10 + icon +
    // label + paddingBottom 20).
    bottom: 74,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    backgroundColor: "#2b1f35",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  cancel: { justifyContent: "center", paddingHorizontal: 8 },
  cancelText: { color: colors.muted, fontWeight: "800", fontSize: 13 },
  // Primary action — the one we want people to actually reach for.
  venueButton: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  venueButtonText: { color: colors.bg, fontWeight: "900", fontSize: 12.5 },
  // Secondary/destructive — outlined and muted on purpose, so it doesn't
  // compete for attention or catch an accidental tap.
  remove: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  actionOff: { opacity: 0.4 },
  removeText: { color: colors.muted, fontWeight: "700", fontSize: 12.5 },
});
