import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";

const DIFFICULTY_COLOR: Record<Dance["difficulty"], string> = {
  Beginner: colors.green,
  Improver: colors.gold,
  Intermediate: colors.pink,
  Advanced: colors.pink,
};

export function DanceCard({
  dance,
  song,
  progress,
  onPress,
  fromFriend,
  // When defined, the card is in pick-list mode and shows a checkbox
  // instead of the chevron (see FriendDancesModal's "select dances").
  selected,
  note,
  dimmed,
}: {
  dance: Dance;
  song: string;
  progress?: DanceProgress;
  onPress: () => void;
  fromFriend?: string;
  selected?: boolean;
  /** Short line under the song, e.g. "Already in your list". */
  note?: string;
  dimmed?: boolean;
}) {
  const icon =
    progress?.status === "learned"
      ? "⭐"
      : progress?.status === "want"
        ? "💗"
        : progress?.status === "maybe"
          ? "🔖"
          : "👢"; //"♪";

  const choreographer = dance.choreographers?.join(", ");
  const otherSongs = dance.songSwaps.map((swap) => swap.songName);

  return (
    <Pressable style={[s.card, dimmed && s.dimmed]} onPress={onPress}>
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

        {/* {progress?.personalSongSwap && (
          <Text style={s.personalSwap} numberOfLines={1}>
            Song swap: {progress.personalSongSwap}
          </Text>
        )} */}

        {otherSongs.length > 0 && (
          <Text style={s.catalogSwaps} numberOfLines={1}>
            Also danced to: {otherSongs.join(", ")}
          </Text>
        )}

        {dance.details ? <Text style={s.meta}>{dance.details}</Text> : null}
        {note ? <Text style={s.note}>{note}</Text> : null}
      </View>
      {selected !== undefined ? (
        <View style={[s.checkbox, selected && s.checkboxOn]}>
          {selected && <Text style={s.checkmark}>✓</Text>}
        </View>
      ) : (
        !fromFriend && <Text style={s.arrow}>›</Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 13,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
  },
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
  personalSwap: {
    color: colors.pink,
    fontSize: 12,
    marginTop: 5,
    fontWeight: "700",
  },
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
});
