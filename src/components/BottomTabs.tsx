import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
export type AppTab = "Home" | "Want to learn" | "Learned" | "Profile";
export function BottomTabs({
  activeTab,
  onChange,
}: {
  activeTab: AppTab;
  onChange: (tab: AppTab) => void;
}) {
  const tabs: { name: AppTab; icon: string }[] = [
    { name: "Home", icon: "⌂" },
    { name: "Want to learn", icon: "♡" },
    { name: "Learned", icon: "★" },
    { name: "Profile", icon: "☻" },
  ];
  return (
    <View style={s.tabs}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.name}
          style={s.tab}
          onPress={() => onChange(tab.name)}
        >
          <Text style={[s.icon, activeTab === tab.name && s.active]}>
            {tab.icon}
          </Text>
          <Text style={[s.label, activeTab === tab.name && s.active]}>
            {tab.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  tabs: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    backgroundColor: "#21172a",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
    paddingBottom: 20,
  },
  tab: { flex: 1, alignItems: "center" },
  icon: { fontSize: 22, color: colors.muted },
  label: { fontSize: 10, color: colors.muted, marginTop: 3 },
  active: { color: colors.gold },
});
