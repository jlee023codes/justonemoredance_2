import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";

const FEATURE_ROWS: { icon: string; label: string; note: string }[] = [
  {
    icon: "⌂",
    label: "Home",
    note: "Search the full dance catalog and add anything you find to your list.",
  },
  {
    icon: "≣",
    label: "My List",
    note: "Everything you've saved — Want to Learn, Learning Now, and Learned. Search, filter, and sort it here.",
  },
  {
    icon: "📍",
    label: "Venues",
    note: "Browse the shared venue catalog and see what dances people report at each one. Premium.",
  },
  {
    icon: "👥",
    label: "Friends",
    note: "See friends' activity, plan a night out together, and import a dance straight from their list. Premium.",
  },
  {
    icon: "☻",
    label: "Profile",
    note: "Your account, My Venues, and subscription settings.",
  },
];

export function HelpModal({
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
          <Text style={s.title}>Where to find things</Text>
          <Text style={s.subtitle}>
            A quick tour of each tab, bottom to top.
          </Text>
          <View style={s.rows}>
            {FEATURE_ROWS.map((row) => (
              <View key={row.label} style={s.row}>
                <Text style={s.icon}>{row.icon}</Text>
                <View style={s.copy}>
                  <Text style={s.label}>{row.label}</Text>
                  <Text style={s.note}>{row.note}</Text>
                </View>
              </View>
            ))}
          </View>
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
    gap: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  icon: {
    fontSize: 20,
    width: 34,
    color: colors.gold,
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
    lineHeight: 17,
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
