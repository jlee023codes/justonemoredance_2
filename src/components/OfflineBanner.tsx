import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../styles";

// Sits just under the header. Shows while the browser is offline, or once
// it's back online with a non-empty offline notepad still waiting to be
// imported. Tapping it opens the notepad.
export function OfflineBanner({
  online,
  pendingCount,
  onPress,
}: {
  online: boolean;
  pendingCount: number;
  onPress: () => void;
}) {
  if (online && pendingCount === 0) return null;

  return (
    <Pressable
      style={[s.banner, online ? s.online : s.offline]}
      onPress={onPress}
    >
      <Text style={s.text}>
        {online
          ? `✓ Back online — ${pendingCount} dance${
              pendingCount === 1 ? "" : "s"
            } ready to import`
          : "⚡ Offline mode — dances you add are saved on this device"}
      </Text>
      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 9,
  },
  offline: { backgroundColor: "#4a3a1e" },
  online: { backgroundColor: "#20402e" },
  text: { color: colors.ink, fontSize: 12, fontWeight: "800", flex: 1 },
  chevron: { color: colors.ink, fontSize: 18, fontWeight: "800" },
});
