import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { LiveDance, loadLiveVenueView, subscribeLiveSession } from "../lib/liveSession";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

/** Read-only peek at a venue's current live session, opened from the
 *  Venues screen by anyone browsing — not checked in there. Shows the
 *  same shared dance pool a participant's session screen does (same
 *  gap-based window, see loadLiveVenueView), minus anything that
 *  requires being a participant: no logging, no "danced" toggle, no
 *  per-user stats. Live-updates the same way the real session screen
 *  does — Realtime subscription with a poll fallback. */
export function LiveLoggingModal({
  venueId,
  venueName,
  onClose,
}: {
  venueId: string | null;
  venueName: string;
  onClose: () => void;
}) {
  const [dances, setDances] = useState<LiveDance[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = (id: string) => {
    loadLiveVenueView(id)
      .then(({ dances, participantCount }) => {
        setDances(dances);
        setParticipantCount(participantCount);
      })
      .catch((err: any) => setError(err?.message ?? "Could not load the live list."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!venueId) return;
    setLoading(true);
    setError("");
    refresh(venueId);

    const unsubscribe = subscribeLiveSession(venueId, () => refresh(venueId));
    const pollTimer = setInterval(() => refresh(venueId), 15000);
    return () => {
      unsubscribe();
      clearInterval(pollTimer);
    };
  }, [venueId]);

  if (!venueId) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.screen}>
        <View style={s.topRow}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
          <View style={s.titleCopy}>
            <Text style={s.title} numberOfLines={2}>{venueName}</Text>
            <Text style={s.subtitle}>
              🔴 Live now · {participantCount} {participantCount === 1 ? "person" : "people"} checked in
            </Text>
          </View>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        {loading && <ActivityIndicator color={colors.gold} style={s.loader} />}

        {!loading && !dances.length && !error && (
          <Text style={s.empty}>Nothing logged here yet tonight.</Text>
        )}

        <ScrollView contentContainerStyle={s.list}>
          {dances.map((d) => (
            <View key={d.id} style={s.row}>
              <View style={s.rowMain}>
                <Text style={s.danceName} numberOfLines={1}>{d.name}</Text>
                <Text style={s.loggedBy}>
                  logged by {d.loggedByName} · {timeAgo(d.loggedAt)}
                </Text>
              </View>
              {d.dancedCount > 0 && (
                <View style={s.dancedPill}>
                  <Text style={s.dancedPillText}>💃 {d.dancedCount}</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: 60 },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: { color: colors.muted, fontSize: 15, fontWeight: "800" },
  titleCopy: { flex: 1 },
  title: { color: colors.ink, fontSize: 19, fontWeight: "900", lineHeight: 23 },
  subtitle: { color: colors.gold, fontSize: 12, fontWeight: "700", marginTop: 3 },
  error: { color: "#ff8080", fontSize: 13, marginHorizontal: 20, marginTop: 14 },
  loader: { marginTop: 24 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20, marginHorizontal: 20, marginTop: 20 },
  list: { padding: 20, paddingBottom: 50, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  rowMain: { flex: 1 },
  danceName: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  loggedBy: { color: colors.muted, fontSize: 11.5, marginTop: 2 },
  dancedPill: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dancedPillText: { color: colors.gold, fontSize: 12, fontWeight: "800" },
});
