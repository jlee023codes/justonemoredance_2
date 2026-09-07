import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";

/** The outlined pill that turns a list into "select to remove" mode. */
export function SelectToRemoveButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={s.toggle} onPress={onPress} hitSlop={6}>
      <Text style={s.toggleIcon}>🗑</Text>
      <Text style={s.toggleText}>Select to remove</Text>
    </Pressable>
  );
}

/** Floating action bar shown while selecting — stays put as the list scrolls. */
export function BulkRemoveBar({
  count,
  onRemove,
  onCancel,
}: {
  count: number;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={s.bar}>
      <Pressable style={s.cancel} onPress={onCancel} hitSlop={8}>
        <Text style={s.cancelText}>Cancel</Text>
      </Pressable>
      <Pressable
        style={[s.remove, !count && s.removeOff]}
        onPress={onRemove}
        disabled={!count}
      >
        <Text style={s.removeText}>
          {count ? `Remove ${count}` : "Select dances to remove"}
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
  toggleIcon: { fontSize: 12 },
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
    gap: 10,
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
  cancel: { justifyContent: "center", paddingHorizontal: 14 },
  cancelText: { color: colors.muted, fontWeight: "800", fontSize: 13 },
  remove: {
    flex: 1,
    backgroundColor: colors.pink,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  removeOff: { backgroundColor: colors.line },
  removeText: { color: "#fff", fontWeight: "900", fontSize: 14 },
});
