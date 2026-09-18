import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";

export type PlaylistSyncProvider = "spotify" | "apple";

/** Shown only when a sync-plan found tracks that were synced before, are
 *  still sitting in the playlist untouched, but no longer on My List —
 *  never removed without asking first. See src/lib/playlistDiff.ts. */
export function PlaylistSyncModal({
  visible,
  provider,
  danceNames,
  onKeep,
  onRemove,
  onClose,
}: {
  visible: boolean;
  provider: PlaylistSyncProvider;
  // One name per candidate track — a track can map to more than one dance
  // (two choreographies, same song), so this is already flattened/deduped
  // by the caller.
  danceNames: string[];
  onKeep: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const providerName = provider === "spotify" ? "Spotify" : "Apple Music";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Text style={s.title}>Removed from My List</Text>
          <Text style={s.subtitle}>
            You removed {danceNames.length} dance{danceNames.length === 1 ? "" : "s"} from My
            List. They're still in your {providerName} playlist — keep them there, or remove
            them too?
          </Text>

          <ScrollView style={s.list}>
            {danceNames.map((name, i) => (
              <Text key={`${name}-${i}`} style={s.danceName}>
                • {name}
              </Text>
            ))}
          </ScrollView>

          <Pressable style={s.keepButton} onPress={onKeep}>
            <Text style={s.keepText}>Keep them in {providerName}</Text>
          </Pressable>
          <Pressable style={s.removeButton} onPress={onRemove}>
            <Text style={s.removeText}>Remove from {providerName} too</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={s.cancel}>Decide later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 34,
    maxHeight: "80%",
  },
  title: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 8, lineHeight: 19 },
  list: { marginTop: 14, marginBottom: 6, maxHeight: 180 },
  danceName: { color: colors.ink, fontSize: 14, paddingVertical: 4, fontWeight: "600" },
  keepButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 16,
  },
  keepText: { color: colors.bg, fontWeight: "900", fontSize: 15 },
  removeButton: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 10,
  },
  removeText: { color: colors.muted, fontWeight: "700", fontSize: 14 },
  cancel: { color: colors.muted, textAlign: "center", fontWeight: "700", marginTop: 16 },
});
