import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { TabIcon, TabIconName } from "./TabIcon";
export type AppTab = "Home" | "My List" | "Venues" | "Friends" | "Profile";
export function BottomTabs({
  activeTab,
  onChange,
  // Unread counts per tab — currently just pending friend requests on
  // Friends, which is otherwise easy to never notice.
  badges,
}: {
  activeTab: AppTab;
  onChange: (tab: AppTab) => void;
  badges?: Partial<Record<AppTab, number>>;
}) {
  const tabs: { name: AppTab; icon: TabIconName }[] = [
    { name: "Home", icon: "home" },
    { name: "My List", icon: "list" },
    { name: "Venues", icon: "pin" },
    { name: "Friends", icon: "people" },
    { name: "Profile", icon: "person" },
  ];
  return (
    <View style={s.tabs}>
      {tabs.map((tab) => {
        const badge = badges?.[tab.name] ?? 0;
        const active = activeTab === tab.name;
        return (
          <Pressable
            key={tab.name}
            style={s.tab}
            onPress={() => onChange(tab.name)}
          >
            <View style={s.iconBox}>
              <TabIcon name={tab.icon} color={active ? colors.gold : colors.muted} size={22} />
              {badge > 0 && (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{badge > 9 ? "9+" : badge}</Text>
                </View>
              )}
            </View>
            <Text style={[s.label, active && s.active]}>{tab.name}</Text>
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
  // Every icon is now an SVG (see TabIcon.tsx) drawn into the same 24x24
  // box, so centering this box centers the icon exactly — no font/glyph
  // metrics involved, unlike the Unicode-symbol-plus-emoji mix this
  // replaced.
  iconBox: { height: 24, alignItems: "center", justifyContent: "center" },
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
