import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  // Called after a save completes so the parent can update its cached
  // progress map. Pass `null` if nothing about progress actually changed
  // (e.g. "Add to venue list" → "Not now").
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
}) {
  const [venue, setVenue] = useState<VenueOption | null>(null);
  const [songSwap, setSongSwap] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapsOpen, setSwapsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (dance) {
      setVenue(null);
      setSongSwap("");
      setPickerOpen(false);
      setSwapsOpen(false);
      setConfirmOpen(false);
      setError("");
    }
  }, [dance]);

  if (!dance) return null;

  const choreographer = dance.choreographers?.join(", ");
  const danceState = progress?.status ?? undefined;

  const progressFor = (status: LearningStatus): DanceProgress => ({
    danceId: dance.id,
    status,
    fromFriend: progress?.fromFriend,
    danceName: dance.name,
    danceSong: dance.defaultSong,
    danceDifficulty: dance.difficulty,
  });

  const handleAddToVenueList = async () => {
    if (!venue) return;
    setSaving(true);
    setError("");
    try {
      await saveVenueDance(userId, venue.id, dance, songSwap.trim());
      setConfirmOpen(true);
    } catch (err: any) {
      setError(err.message ?? "Could not save that venue.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmStatus = async (status: LearningStatus | null) => {
    if (status) {
      setSaving(true);
      setError("");
      try {
        const next = progressFor(status);
        await saveProgress(userId, next, dance);
        onProgressChange(dance.id, next);
      } catch (err: any) {
        setSaving(false);
        setError(err.message ?? "Could not save.");
        return;
      }
      setSaving(false);
    } else {
      onProgressChange(dance.id, null);
    }
    setConfirmOpen(false);
    onClose();
  };

  const handleDirectStatus = async (status: LearningStatus) => {
    setSaving(true);
    setError("");
    try {
      if (venue) {
        await saveVenueDance(userId, venue.id, dance, songSwap.trim());
      }
      const next = progressFor(status);
      await saveProgress(userId, next, dance);
      onProgressChange(dance.id, next);
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Could not save.");
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

            <Text style={s.fieldLabel}>
              VENUE <Text style={s.optional}>(find or add)</Text>
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

            {error ? <Text style={s.error}>{error}</Text> : null}

            <Pressable
              style={[s.venueAction, !venue && s.disabled]}
              onPress={handleAddToVenueList}
              disabled={!venue || saving}
            >
              <Text style={s.venueActionText}>
                {saving ? "Saving…" : "＋ Add to my venue list"}
              </Text>
            </Pressable>

            {danceState !== "want" && danceState !== "learned" && (
              <Pressable
                style={s.primary}
                onPress={() => handleDirectStatus("want")}
                disabled={saving}
              >
                <Text style={s.primaryText}>♡ Want to learn</Text>
              </Pressable>
            )}

            {danceState !== "learned" && (
              <Pressable
                style={s.secondary}
                onPress={() => handleDirectStatus("learned")}
                disabled={saving}
              >
                <Text style={s.secondaryText}>★ I learned it</Text>
              </Pressable>
            )}

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

      <Modal visible={confirmOpen} transparent animationType="fade">
        <View style={s.confirmOverlay}>
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>Added to {venue?.name}!</Text>
            <Text style={s.confirmBody}>
              Want to also mark “{dance.name}” as learned, or something you
              want to learn?
            </Text>
            {saving ? (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            ) : (
              <>
                <Pressable
                  style={s.primary}
                  onPress={() => handleConfirmStatus("want")}
                >
                  <Text style={s.primaryText}>♡ Want to learn</Text>
                </Pressable>
                <Pressable
                  style={s.secondary}
                  onPress={() => handleConfirmStatus("learned")}
                >
                  <Text style={s.secondaryText}>★ I learned it</Text>
                </Pressable>
                <Pressable onPress={() => handleConfirmStatus(null)}>
                  <Text style={s.cancel}>Not now</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  error: {
    color: "#ff8080",
    fontSize: 13,
    marginTop: 12,
  },
  venueAction: {
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 20,
  },
  venueActionText: {
    color: colors.gold,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.4,
  },
  primary: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 12,
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
  confirmOverlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 28,
  },
  confirmCard: {
    backgroundColor: "#2b1f35",
    borderRadius: 24,
    padding: 24,
  },
  confirmTitle: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "900",
  },
  confirmBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  loader: {
    marginVertical: 20,
  },
});
