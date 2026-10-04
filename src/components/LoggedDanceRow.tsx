import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { DIFFICULTY_COLOR } from "./DanceCard";
import { LoggedDance } from "../lib/checkinSession";

/** One dance in a "tonight's dances" style list — the same content
 *  shape everywhere a logged dance is shown (the active session's
 *  TONIGHT list, Stats' per-night dance view): name, song, BootStepper's
 *  details summary, and a difficulty badge pinned to the top-right
 *  corner, same structural convention as DanceCard's own badge.
 *
 *  The four optional props below only render when a live session has
 *  more than one participant — a solo session passes none of them,
 *  so its row looks pixel-identical to before this existed. */
export function LoggedDanceRow({
  dance,
  loggedByName,
  dancedCount,
  dancedByMe,
  onToggleDanced,
}: {
  dance: LoggedDance;
  loggedByName?: string;
  dancedCount?: number;
  dancedByMe?: boolean;
  onToggleDanced?: () => void;
}) {
  return (
    <View style={s.row}>
      {dance.difficulty && (
        <View style={[s.badge, { borderColor: DIFFICULTY_COLOR[dance.difficulty] }]}>
          <Text style={[s.badgeText, { color: DIFFICULTY_COLOR[dance.difficulty] }]}>
            {dance.difficulty}
          </Text>
        </View>
      )}
      <Text style={s.name} numberOfLines={1}>{dance.name}</Text>
      {dance.song ? (
        <Text style={s.song} numberOfLines={1}>{dance.song}</Text>
      ) : null}
      {dance.details ? (
        <Text style={s.details} numberOfLines={1}>{dance.details}</Text>
      ) : null}
      {loggedByName && (
        <Text style={s.loggedBy} numberOfLines={1}>logged by {loggedByName}</Text>
      )}
      {onToggleDanced && (
        <Pressable
          style={[s.dancedPill, dancedByMe && s.dancedPillOn]}
          onPress={onToggleDanced}
          hitSlop={6}
        >
          <Text style={[s.dancedPillText, dancedByMe && s.dancedPillTextOn]}>
            {dancedByMe ? "✓ Danced" : "Danced?"}
            {dancedCount ? ` (${dancedCount})` : ""}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    paddingRight: 54,
    marginBottom: 8,
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 10,
    right: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "800" },
  name: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  song: { color: colors.muted, fontSize: 12, marginTop: 2 },
  details: { color: colors.gold, fontSize: 11, fontWeight: "700", marginTop: 3 },
  loggedBy: { color: colors.muted, fontSize: 11, fontStyle: "italic", marginTop: 4 },
  dancedPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  dancedPillOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  dancedPillText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  dancedPillTextOn: { color: "#fff" },
});
