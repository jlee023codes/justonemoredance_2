import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dance, DanceEntry, DanceProgress, LearningStatus } from "../types";
import { venues } from "../data";
import { colors } from "../styles";
import { VenuePicker } from "./VenuePicker";



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
  const [addingVenue, setAddingVenue] = useState(false);

  useEffect(() => {
    if (dance) {
      setVenueId(progress?.personalVenueId ?? defaultVenueId);
      setSongSwap(progress?.personalSongSwap ?? "");
      setAddingVenue(false);
    }
  }, [dance, defaultVenueId, progress]);

  if (!dance) return null;

  const availableVenueIds = dance.venueSongs.map(
    (venueSong) => venueSong.venueId,
  );

  const availableVenueSongs = dance.venueSongs;

  const selectedVenueSong = availableVenueSongs.find(
    (venueSong) => venueSong.venueId === venueId,
  );

  const venueName =
    venues.find((venue) => venue.id === venueId)?.name ??
    selectedVenueSong?.venueName ??
    "Choose a venue";

  const catalogSong = selectedVenueSong?.song ?? "";

  const entry: DanceEntry = {
    venueId,
    songSwap: songSwap.trim(),
    isNewVenue: addingVenue,
    catalogSong,
  };

  const danceState = progress?.status ?? undefined;

  const handleExistingVenue = (id: string) => {
    setVenueId(id);
    setSongSwap("");
    setAddingVenue(false);
    setPickerOpen(false);
  };

  const handleAddVenue = () => {
    setAddingVenue(true);
    setVenueId("");
    setSongSwap("");
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <ScrollView
            contentContainerStyle={s.sheet}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.title}>{dance.name}</Text>
            <Text style={s.song}>{dance.defaultSong}</Text>
            <Text style={s.level}>{dance.difficulty}</Text>
            <Text style={s.body}>{dance.details}</Text>

            <Text style={s.fieldLabel}>
              VENUE <Text style={s.optional}>(optional)</Text>
            </Text>

            <Pressable style={s.select} onPress={() => setPickerOpen(true)}>
              <Text style={s.selectText}>
                {addingVenue ? "Choose a new venue" : venueName}
              </Text>
              <Text style={s.caret}>▾</Text>
            </Pressable>

            {selectedVenueSong && !addingVenue && (
              <Text style={s.catalogSong}>
                Venue song: {selectedVenueSong.song}
              </Text>
            )}

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

            {danceState !== "want" && danceState !== "learned" && (
              <Pressable
                style={s.primary}
                onPress={() => onSave(dance, "want", entry)}
                disabled={addingVenue && !venueId}
              >
                <Text style={s.primaryText}>♡ Want to learn</Text>
              </Pressable>
            )}

            {danceState !== "learned" && (
              <Pressable
                style={s.secondary}
                onPress={() => onSave(dance, "learned", entry)}
                disabled={addingVenue && !venueId}
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
        title={addingVenue ? "Choose a new venue" : "Venue for this dance"}
        selectedVenueId={venueId}
        onSelect={handleExistingVenue}
        onClose={() => setPickerOpen(false)}
        allowedVenueIds={
          addingVenue
            ? venues
                .map((venue) => venue.id)
                .filter((id) => !availableVenueIds.includes(id))
            : availableVenueIds
        }
        showAddOption={!addingVenue}
        onAddVenue={handleAddVenue}
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
  title: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: "900",
  },
  song: {
    color: colors.gold,
    fontSize: 15,
    marginTop: 7,
  },
  level: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 7,
  },
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
  optional: {
    color: colors.muted,
    fontWeight: "500",
  },
  select: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
  },
  selectText: {
    color: colors.ink,
    fontSize: 16,
    flex: 1,
  },
  caret: {
    color: colors.gold,
    fontSize: 16,
  },
  catalogSong: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 7,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 16,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 7,
  },
  primary: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 22,
  },
  primaryText: {
    color: "#fff",
    fontWeight: "900",
  },
  secondary: {
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryText: {
    color: colors.gold,
    fontWeight: "800",
  },
  cancel: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 19,
  },
});
