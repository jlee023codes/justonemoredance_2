import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dance, DanceProgress, LearningStatus } from "../types";
import { colors } from "../styles";
import { VenuePicker } from "./VenuePicker";
import { saveProgress } from "../services/progress";
import { saveVenueDance, VenueOption } from "../services/venues";

const STATUS_LABEL: Record<LearningStatus, string> = {
  none: "Haven't Heard Of It (Yet)",
  maybe: "💭 Maybe one day",
  want: "♡ Want to learn",
  learned: "★ Learned",
};

export function DanceDetailsModal({
  dance,
  userId,
  progress,
  onClose,
  onProgressChange,
}: {
  dance: Dance | null;
  userId: string;
  progress?: DanceProgress;
  onClose: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
}) {
  const [venue, setVenue] = useState<VenueOption | null>(null);
  const [songSwap, setSongSwap] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapsOpen, setSwapsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dance) {
      setVenue(null);
      setSongSwap("");
      setPickerOpen(false);
      setSwapsOpen(false);
    }
  }, [dance]);

  if (!dance) return null;

  const choreographer = dance.choreographers?.join(", ");
  const danceState = progress?.status;

  const showError = (err: any, fallback: string) =>
    Alert.alert("Something went wrong", err?.message ?? fallback);

  // Any of the three status actions: saves the status, ties the venue if
  // one was picked (best-effort — a venue hiccup shouldn't block the
  // status update, they're conceptually independent), and lets the user
  // know where to find it afterward.
  const handleStatus = async (status: LearningStatus) => {
    setSaving(true);
    let venueSaved = false;
    if (venue) {
      try {
        await saveVenueDance(userId, venue.id, dance, songSwap.trim());
        venueSaved = true;
      } catch (err: any) {
        Alert.alert(
          "Venue not saved",
          `${dance.name} will still be updated, but couldn't be tied to ${venue.name}: ${err?.message ?? "unknown error"}`,
        );
      }
    }
    try {
      const next: DanceProgress = {
        danceId: dance.id,
        status,
        fromFriend: progress?.fromFriend,
        danceName: dance.name,
        danceSong: dance.defaultSong,
        danceDifficulty: dance.difficulty,
      };
      await saveProgress(userId, next, dance);
      onProgressChange(dance.id, next);
      if (!venue && !danceState){
        Alert.alert(
        "Saved",
        `${dance.name} was added to My Venues → My List${
          venueSaved ? ` and tagged to ${venue!.name}` : ""
        }.`,
      );}
      onClose();
    } catch (err: any) {
      showError(err, "Could not save your progress.");
    } finally {
      setSaving(false);
    }
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
            {choreographer && (
              <Text style={s.choreographer}>by {choreographer}</Text>
            )}
            <Text style={s.song}>{dance.defaultSong}</Text>
            <View style={s.metaRow}>
              <Text style={s.level}>{dance.difficulty}</Text>
              {dance.details ? (
                <Text style={s.details}>{dance.details}</Text>
              ) : null}
            </View>

            {dance.songSwaps.length > 0 && (
              <>
                <Pressable
                  style={s.swapsToggle}
                  onPress={() => setSwapsOpen((open) => !open)}
                >
                  <Text style={s.swapsToggleText}>
                    ♫ {dance.songSwaps.length} other song
                    {dance.songSwaps.length > 1 ? "s" : ""} danced to this
                  </Text>
                  <Text style={s.caret}>{swapsOpen ? "▴" : "▾"}</Text>
                </Pressable>
                {swapsOpen && (
                  <View style={s.swapsList}>
                    {dance.songSwaps.map((swap) => (
                      <Text key={swap.id} style={s.swapItem}>
                        • {swap.songName}
                      </Text>
                    ))}
                  </View>
                )}
              </>
            )}

            {danceState && (
              <View style={s.statusBadge}>
                <Text style={s.statusBadgeText}>
                  {STATUS_LABEL[danceState]}
                </Text>
              </View>
            )}

            <Text style={s.fieldLabel}>
              VENUE <Text style={s.optional}>(optional)</Text>
            </Text>

            <Pressable style={s.select} onPress={() => setPickerOpen(true)}>
              <Text style={s.selectText}>
                {venue ? venue.name : "Choose a venue"}
              </Text>
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

             {danceState !== "maybe" && <Pressable
              style={s.tertiary}
              onPress={() => handleStatus("maybe")}
              disabled={saving}
            >
              <Text style={s.tertiaryText}>{danceState === "learned"? "🧠 Need to Reivew" :  "💭 Maybe one day"}</Text>
            </Pressable>} 

            {danceState !== "want" &&<Pressable
              style={s.secondary}
              onPress={() => handleStatus("want")}
              disabled={saving}
            >
              <Text style={s.secondaryText}>♡ Want to learn</Text>
            </Pressable>}

            {danceState !== "learned" &&<Pressable
              style={s.primary}
              onPress={() => handleStatus("learned")}
              disabled={saving}
            >
              <Text style={s.primaryText}>★ Learned it</Text>
            </Pressable>}

            <Pressable onPress={onClose} disabled={saving}>
              <Text style={s.cancel}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>

      <VenuePicker
        visible={pickerOpen}
        selectedVenueId={venue?.id}
        onSelect={(picked) => {
          setVenue(picked);
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
  title: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: "900",
  },
  choreographer: {
    color: colors.muted,
    fontSize: 14,
    fontStyle: "italic",
    marginTop: 5,
  },
  song: {
    color: colors.gold,
    fontSize: 15,
    marginTop: 7,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 7,
  },
  level: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "700",
  },
  details: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 10,
  },
  swapsToggle: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
  },
  swapsToggleText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },
  swapsList: {
    marginTop: 8,
    paddingLeft: 4,
  },
  swapItem: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 5,
  },
  statusBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#392746",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 14,
  },
  statusBadgeText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
  },
  fieldLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 18,
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
  tertiary: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 22,
  },
  tertiaryText: {
    color: colors.muted,
    fontWeight: "700",
  },
  primary: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 10,
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
