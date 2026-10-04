import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { Avatar } from "./Avatar";
import { Challenge, ChallengeScore, challengeDisplayLabel, loadChallengeScores } from "../services/challenges";

function formatDateRange(startsOn: string, endsOn: string): string {
  const fmt = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

/** Two independent ranked tables — dances logged, steps taken — for a
 *  challenge, switched via a tab row rather than stacked. Accepted
 *  participants rank by their number; anyone who hasn't answered yet
 *  shows below them, greyed out, as "waiting." Declined invitees are
 *  left out entirely — they opted out, unlike "waiting" which implies
 *  they still might join. No combined score/winner (explicit design
 *  decision). Row visual language matches StatsScreen.tsx's session
 *  cards. */
export function ChallengeLeaderboardModal({
  challenge,
  myUserId,
  onClose,
}: {
  challenge: Challenge | null;
  myUserId: string;
  onClose: () => void;
}) {
  const [scores, setScores] = useState<ChallengeScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"dances" | "steps">("dances");

  useEffect(() => {
    if (!challenge) return;
    setTab("dances");
    setLoading(true);
    setError("");
    loadChallengeScores(challenge.id)
      .then(setScores)
      .catch((err: any) => setError(err?.message ?? "Could not load scores."))
      .finally(() => setLoading(false));
  }, [challenge]);

  if (!challenge) return null;

  const visible = challenge.participants.filter((p) => p.status !== "declined");
  const scoreByUser = new Map(scores.map((s) => [s.userId, s]));
  const rows = visible.map((p) => ({
    friend: p.friend,
    status: p.status,
    danceCount: scoreByUser.get(p.friend.id)?.danceCount ?? 0,
    stepCount: scoreByUser.get(p.friend.id)?.stepCount ?? 0,
  }));
  const accepted = rows.filter((r) => r.status === "accepted");
  const waiting = rows.filter((r) => r.status === "pending");
  const byDances = [...accepted].sort((a, b) => b.danceCount - a.danceCount);
  const bySteps = [...accepted].sort((a, b) => b.stepCount - a.stepCount);

  const activeRows = tab === "dances" ? byDances : bySteps;
  const unit = tab === "dances" ? "dance" : "steps";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
          <Text style={s.title}>⚔️ {challengeDisplayLabel(challenge, myUserId)}</Text>
          <Text style={s.subtitle}>{formatDateRange(challenge.startsOn, challenge.endsOn)}</Text>

          {error ? <Text style={s.error}>{error}</Text> : null}
          {loading && <ActivityIndicator color={colors.gold} style={s.loader} />}

          {!loading && (
            <>
              <View style={s.tabRow}>
                <Pressable
                  style={[s.tab, tab === "dances" && s.tabActive]}
                  onPress={() => setTab("dances")}
                >
                  <Text style={[s.tabText, tab === "dances" && s.tabTextActive]}>🩰 DANCES</Text>
                </Pressable>
                <Pressable
                  style={[s.tab, tab === "steps" && s.tabActive]}
                  onPress={() => setTab("steps")}
                >
                  <Text style={[s.tabText, tab === "steps" && s.tabTextActive]}>👟 STEPS</Text>
                </Pressable>
              </View>

              <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
                {activeRows.map((row, i) => (
                  <LeaderRow
                    key={row.friend.id}
                    rank={i + 1}
                    friend={row.friend}
                    value={tab === "dances" ? row.danceCount : row.stepCount}
                    unit={
                      tab === "dances"
                        ? row.danceCount === 1
                          ? "dance"
                          : "dances"
                        : unit
                    }
                    isMe={row.friend.id === myUserId}
                  />
                ))}

                {waiting.map((row) => (
                  <LeaderRow
                    key={row.friend.id}
                    rank={null}
                    friend={row.friend}
                    value={null}
                    unit=""
                    isMe={row.friend.id === myUserId}
                    muted
                  />
                ))}

                {!activeRows.length && !waiting.length && (
                  <Text style={s.hint}>Nobody's accepted this challenge yet.</Text>
                )}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function LeaderRow({
  rank,
  friend,
  value,
  unit,
  isMe,
  muted,
}: {
  rank: number | null;
  friend: { id: string; displayName: string; avatarUrl: string | null };
  value: number | null;
  unit: string;
  isMe: boolean;
  muted?: boolean;
}) {
  return (
    <View style={[s.row, muted && s.rowMuted]}>
      <Text style={s.rank}>{rank != null ? rank : "–"}</Text>
      <View style={s.rowAvatar}>
        <Avatar avatarUrl={friend.avatarUrl} label={friend.displayName} size={32} />
      </View>
      <Text style={[s.rowName, muted && s.rowNameMuted]} numberOfLines={1}>
        {friend.displayName}
        {isMe ? " (you)" : ""}
      </Text>
      {value != null ? (
        <Text style={s.rowValue}>
          {value.toLocaleString()} <Text style={s.rowUnit}>{unit}</Text>
        </Text>
      ) : (
        <Text style={s.waitingText}>waiting</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 20 },
  sheet: {
    backgroundColor: "#2b1f35",
    borderRadius: 28,
    maxHeight: "80%",
    paddingTop: 25,
    paddingHorizontal: 25,
    paddingBottom: 20,
  },
  closeButton: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#00000055",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", paddingRight: 36 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 4, marginBottom: 14 },
  loader: { marginTop: 20 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  tabTextActive: { color: "#fff" },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 10 },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  rowMuted: { opacity: 0.5 },
  rank: { color: colors.muted, fontSize: 13, fontWeight: "800", width: 18 },
  rowAvatar: { marginRight: 10 },
  rowName: { color: colors.ink, fontSize: 14, fontWeight: "700", flex: 1, paddingRight: 8 },
  rowNameMuted: { color: colors.muted },
  rowValue: { color: colors.gold, fontSize: 14, fontWeight: "900" },
  rowUnit: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  waitingText: { color: colors.muted, fontSize: 12, fontWeight: "700", fontStyle: "italic" },
});
