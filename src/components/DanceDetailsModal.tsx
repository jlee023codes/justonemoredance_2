import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dance, DanceProgress, LearningStatus } from "../types";
import { venues } from "../data";
import { colors } from "../styles";
import { VenuePicker } from "./VenuePicker";
export type DanceEntry = { venueId: string; songSwap: string };
export function DanceDetailsModal({
  dance,
  defaultVenueId,
  progress,
  onClose,
  onSave,
}: {
  dance: Dance | null;
  defaultVenueId: string;
  progress?: DanceProgress;
  onClose: () => void;
  onSave: (dance: Dance, status: LearningStatus, entry: DanceEntry) => void;
}) {
  const [venueId, setVenueId] = useState(defaultVenueId);
  const [songSwap, setSongSwap] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (dance) {
      setVenueId(progress?.personalVenueId ?? defaultVenueId);
      setSongSwap(progress?.personalSongSwap ?? "");
    }
  }, [dance, defaultVenueId, progress]);
  if (!dance) return null;

  const danceState = progress?.status ?? undefined;
  const venueName = venues.find((v) => v.id === venueId)?.name ?? "Everywhere";
  const entry = { venueId, songSwap: songSwap.trim() };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <ScrollView contentContainerStyle={s.sheet} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>{dance.name}</Text>
          <Text style={s.song}>{dance.defaultSong}</Text>
          <Text style={s.level}>{dance.difficulty}</Text>
          <Text style={s.body}>{dance.details}</Text>
          <Text style={s.fieldLabel}>
            VENUE <Text style={s.optional}>(optional)</Text>
          </Text>
          <Pressable style={s.select} onPress={() => setPickerOpen(true)}>
            <Text style={s.selectText}>{venueName}</Text>
            <Text style={s.caret}>▾</Text>
          </Pressable>
          <Text style={s.fieldLabel}>
            SONG SWAP <Text style={s.optional}>(optional)</Text>
          </Text>
          <TextInput
            value={songSwap}
            onChangeText={setSongSwap}
            placeholder="e.g. play it to Shivers"
            placeholderTextColor={colors.muted}
            style={s.input}
          />
          <Text style={s.hint}>
            Save a different song played for this dance at this venue.
          </Text>
          {danceState !== "want" && danceState != "learned" && (
            <Pressable
              style={s.primary}
              onPress={() => onSave(dance, "want", entry)}
            >
              <Text style={s.primaryText}>♡ Want to learn</Text>
            </Pressable>
          )}
          {danceState !== "learned" && (
            <Pressable
              style={s.secondary}
              onPress={() => onSave(dance, "learned", entry)}
            >
              <Text style={s.secondaryText}>★ I learned it</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose}>
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
          </ScrollView>
        </View>
      </View>
      <VenuePicker
        visible={pickerOpen}
        title="Venue for this dance"
        selectedVenueId={venueId}
        onSelect={(id) => {
          setVenueId(id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
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
  sheet: {
    padding: 25,
    paddingBottom: 32,
  },
  title: { color: colors.ink, fontSize: 27, fontWeight: "900" },
  song: { color: colors.gold, fontSize: 15, marginTop: 7 },
  level: { color: colors.green, fontSize: 11, fontWeight: "700", marginTop: 7 },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginVertical: 17,
  },
  fieldLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 13,
    marginBottom: 7,
  },
  optional: { color: colors.muted, fontWeight: "500" },
  select: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
  },
  selectText: { color: colors.ink, fontSize: 16, flex: 1 },
  caret: { color: colors.gold, fontSize: 16 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 16,
  },
  hint: { color: colors.muted, fontSize: 12, marginTop: 7 },
  primary: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 22,
  },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  secondary: {
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryText: { color: colors.gold, fontWeight: "800" },
  cancel: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 19,
  },
});
