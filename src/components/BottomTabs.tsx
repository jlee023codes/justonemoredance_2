import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
export type AppTab = "Home" | "My List" | "Profile";
export function BottomTabs({
  activeTab,
  onChange,
  // Unread counts per tab — currently just pending friend requests on
  // Profile, which is otherwise easy to never notice.
  badges,
}: {
  activeTab: AppTab;
  onChange: (tab: AppTab) => void;
  badges?: Partial<Record<AppTab, number>>;
}) {
  const tabs: { name: AppTab; icon: string }[] = [
    { name: "Home", icon: "⌂" },
    { name: "My List", icon: "≣" },
    { name: "Profile", icon: "☻" },
  ];
  return (
    <View style={s.tabs}>
      {tabs.map((tab) => {
        const badge = badges?.[tab.name] ?? 0;
        return (
          <Pressable
            key={tab.name}
            style={s.tab}
            onPress={() => onChange(tab.name)}
          >
            <View>
              <Text style={[s.icon, activeTab === tab.name && s.active]}>
                {tab.icon}
              </Text>
              {badge > 0 && (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{badge > 9 ? "9+" : badge}</Text>
                </View>
              )}
            </View>
            <Text style={[s.label, activeTab === tab.name && s.active]}>
              {tab.name}
            </Text>
          </Pressable>
        );
      })}
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
  badge: {
    position: "absolute",
    top: -3,
    right: -10,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
});
