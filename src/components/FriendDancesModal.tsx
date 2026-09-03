import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { DanceCard } from "./DanceCard";
import { Friend, FriendDance, loadFriendDances } from "../services/friends";

function toDance(fd: FriendDance): Dance {
  return {
    id: fd.danceId,
    name: fd.name,
    defaultSong: fd.song,
    difficulty: fd.difficulty,
    details: "",
    venueSongs: [],
    songSwaps: [],
  };
}

function toProgress(fd: FriendDance): DanceProgress {
  return { danceId: fd.danceId, status: fd.status };
}

export function FriendDancesModal({
  friend,
  onClose,
}: {
  friend: Friend | null;
  onClose: () => void;
}) {
  const [dances, setDances] = useState<FriendDance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!friend) return;
    setLoading(true);
    setError("");
    loadFriendDances(friend.id)
      .then(setDances)
      .catch((err: any) => setError(err.message ?? "Could not load their list."))
      .finally(() => setLoading(false));
  }, [friend]);

  if (!friend) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
          <ScrollView contentContainerStyle={s.sheet}>
            <Text style={s.title}>{friend.displayName}'s list</Text>
            <Text style={s.subtitle}>Read-only — this is their My List</Text>

            {loading && <ActivityIndicator color={colors.gold} style={s.loader} />}
            {error ? <Text style={s.error}>{error}</Text> : null}

            {!loading &&
              dances.map((fd) => (
                <DanceCard
                  key={fd.danceId}
                  dance={toDance(fd)}
                  song={fd.song}
                  progress={toProgress(fd)}
                  onPress={() => {}}
                  fromFriend={true}
                />
              ))}

            {!loading && !dances.length && !error && (
              <Text style={s.empty}>
                {friend.displayName} hasn't marked any dances yet.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#2b1f35",
    borderRadius: 28,
    maxHeight: "88%",
    overflow: "hidden",
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
  closeButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  sheet: {
    padding: 25,
    paddingBottom: 32,
  },
  title: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    paddingRight: 36,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 18,
  },
  loader: {
    marginTop: 20,
  },
  error: {
    color: "#ff8080",
    fontSize: 13,
    marginTop: 10,
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
