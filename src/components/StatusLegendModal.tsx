import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";

// The icon shown on the left of a dance card, keyed to its saved status.
// Keep in sync with DanceCard's `icon` logic.
const STATUS_ROWS: { icon: string; label: string; note: string }[] = [
  {
    icon: "👢",
    label: "Not on your lists",
    note: "You haven't saved this dance yet",
  },
  {
    icon: "🔖",
    label: "Saved for later",
    note: "Maybe someday — parked for now",
  },
  { icon: "💗", label: "Want to learn", note: "On your Want to Learn list" },
  { icon: "⭐", label: "Learned", note: "It's in your pocket" },
  {
    icon: "🔁",
    label: "Review",
    note: "Send back to Want to Learn... not confident yet",
  },
];

export function StatusLegendModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Text style={s.title}>What the icons mean</Text>
          <Text style={s.subtitle}>
            The icon on each dance card shows where it sits in your lists.
          </Text>
          <View style={s.rows}>
            {STATUS_ROWS.map((row) => (
              <View key={row.icon} style={s.row}>
                <Text style={s.icon}>{row.icon}</Text>
                <View style={s.copy}>
                  <Text style={s.label}>{row.label}</Text>
                  <Text style={s.note}>{row.note}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={s.footnote}>
            Tap the buttons under a card to set or clear its status.
          </Text>
          <Pressable style={s.done} onPress={onClose} hitSlop={8}>
            <Text style={s.doneText}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: "#2b1f35",
    borderRadius: 22,
    padding: 24,
  },
  title: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  rows: {
    marginTop: 18,
    gap: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    fontSize: 22,
    width: 40,
  },
  copy: {
    flex: 1,
  },
  label: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  note: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  footnote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 20,
  },
  done: {
    marginTop: 20,
    alignSelf: "flex-end",
  },
  doneText: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: "800",
  },
});
