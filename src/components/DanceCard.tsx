import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";

const DIFFICULTY_COLOR: Record<Dance["difficulty"], string> = {
  Beginner: colors.green,
  Improver: colors.gold,
  Intermediate: colors.pink,
  Advanced: colors.pink,
};

// `maybe` is "Save for Later".
export type QuickStatus = "maybe" | "want" | "learned";
export type QuickAction = { status: QuickStatus; icon: string; label: string };

// The full row shown on Home / My List. Screens that only want one
// contextual button (Want list → promote to Learned; Learned list →
// "Review", i.e. back to Want) pass their own `quickActions`.
const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { status: "maybe", icon: "🔖", label: "Later" },
  { status: "want", icon: "♡", label: "Want" },
  { status: "learned", icon: "★", label: "Learned" },
];

export function DanceCard({
  dance,
  song,
  progress,
  onPress,
  fromFriend,
  // When defined, the card grows a row of quick-action icon buttons.
  // Tapping one sets that status; tapping the one that's already lit
  // clears it. The card body still opens the details modal.
  onQuickStatus,
  // Override which quick actions show (default: Later / Want / Learned).
  quickActions = DEFAULT_QUICK_ACTIONS,
  // When defined, the card is in pick-list mode and shows a checkbox
  // instead of the chevron (FriendDancesModal's "select dances", and the
  // "Select to remove" mode on the My List / Want / Learned tabs).
  selected,
  // When defined (and not in pick-list mode), shows a small trash button
  // on the right — the parent handles the confirm.
  onDelete,
  note,
  dimmed,
}: {
  dance: Dance;
  song: string;
  progress?: DanceProgress;
  onPress: () => void;
  fromFriend?: string;
  onQuickStatus?: (status: QuickStatus) => void;
  quickActions?: QuickAction[];
  selected?: boolean;
  onDelete?: () => void;
  /** Short line under the song, e.g. "Already in your list". */
  note?: string;
  dimmed?: boolean;
}) {
  const picking = selected !== undefined;
  const status = progress?.status;
  const icon =
    status === "learned"
      ? "⭐"
      : status === "want"
        ? "💗"
        : status === "maybe"
          ? "🔖"
          : "👢";

  const choreographer = dance.choreographers?.join(", ");
  const otherSongs = dance.songSwaps.map((swap) => swap.songName);

  return (
    <View style={[s.card, dimmed && s.dimmed]}>
      <View style={s.mainRow}>
        <Pressable style={s.main} onPress={onPress}>
          <Text style={s.icon}>{icon}</Text>
          <View style={s.copy}>
            <View style={s.titleRow}>
              <Text style={s.title} numberOfLines={1}>
                {dance.name}
              </Text>
              <View
                style={[
                  s.badge,
                  { borderColor: DIFFICULTY_COLOR[dance.difficulty] },
                ]}
              >
                <Text
                  style={[
                    s.badgeText,
                    { color: DIFFICULTY_COLOR[dance.difficulty] },
                  ]}
                >
                  {dance.difficulty}
                </Text>
              </View>
            </View>

            {choreographer && (
              <Text style={s.choreographer} numberOfLines={1}>
                by {choreographer}
              </Text>
            )}

            <Text style={s.song} numberOfLines={1}>
              {song}
            </Text>

            {otherSongs.length > 0 && (
              <Text style={s.catalogSwaps} numberOfLines={1}>
                Also danced to: {otherSongs.join(", ")}
              </Text>
            )}

            {dance.details ? <Text style={s.meta}>{dance.details}</Text> : null}
            {note ? <Text style={s.note}>{note}</Text> : null}
          </View>

          {picking ? (
            <View style={[s.checkbox, selected && s.checkboxOn]}>
              {selected && <Text style={s.checkmark}>✓</Text>}
            </View>
          ) : !onDelete && !fromFriend && !onQuickStatus ? (
            <Text style={s.arrow}>›</Text>
          ) : null}
        </Pressable>

        {!picking && onDelete && (
          <Pressable style={s.deleteButton} onPress={onDelete} hitSlop={8}>
            <Text style={s.deleteIcon}>🗑</Text>
          </Pressable>
        )}
      </View>

      {onQuickStatus && !picking && (
        <View style={s.quickRow}>
          {quickActions.map((action) => {
            const active = status === action.status;
            return (
              <Pressable
                key={action.status}
                style={[s.quickButton, active && s.quickButtonOn]}
                onPress={() => onQuickStatus(action.status)}
                hitSlop={6}
              >
                <Text style={[s.quickIcon, active && s.quickTextOn]}>
                  {action.icon}
                </Text>
                <Text
                  style={[s.quickLabel, active && s.quickTextOn]}
                  numberOfLines={1}
                >
                  {action.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 13,
    marginBottom: 9,
  },
  mainRow: { flexDirection: "row", alignItems: "center" },
  main: { flex: 1, flexDirection: "row", alignItems: "center" },
  icon: { fontSize: 23, width: 38 },
  copy: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: { color: colors.ink, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "800" },
  choreographer: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
    fontStyle: "italic",
  },
  song: { color: colors.muted, fontSize: 12, marginTop: 4 },
  catalogSwaps: { color: colors.muted, fontSize: 11, marginTop: 4 },
  meta: { color: colors.green, fontSize: 11, fontWeight: "700", marginTop: 7 },
  note: { color: colors.gold, fontSize: 11, fontWeight: "700", marginTop: 6 },
  arrow: { color: colors.gold, fontSize: 27 },
  dimmed: { opacity: 0.5 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.line,
    marginLeft: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  checkmark: { color: "#fff", fontSize: 14, fontWeight: "900" },
  deleteButton: {
    marginLeft: 8,
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteIcon: { fontSize: 15 },
  quickRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  quickButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  quickButtonOn: {
    borderColor: colors.pink,
    backgroundColor: "#3a1f30",
  },
  quickIcon: { fontSize: 13, color: colors.muted },
  quickLabel: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
    color: colors.muted,
  },
  quickTextOn: { color: colors.pink },
});
