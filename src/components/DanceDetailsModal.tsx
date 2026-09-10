import { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
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
import {
  // The modal's status *buttons* are commented out (see handleStatus below),
  // but saveVenueDance still needs this to keep venue-tagged dances visible
  // in My List — see handleAddVenue.
  saveProgress,
  removeDanceEverywhere,
  setDanceLink,
} from "../services/progress";
import {
  saveVenueDance,
  removeVenueDance,
  loadDanceVenues,
  loadHomeVenueId,
  homeFirst,
  VenueOption,
} from "../services/venues";
import {
  loadSongSwaps,
  addSongSwap,
  deleteSongSwap,
  SongSwapEntry,
} from "../services/songSwaps";

const STATUS_LABEL: Record<LearningStatus, string> = {
  none: "👢 Dont Know It (yet)",
  maybe: "🔖 Save for Later",
  want: "♡ Want to learn",
  learned: "★ Learned",
};

export function DanceDetailsModal({
  dance,
  userId,
  activeTab,
  progress,
  onClose,
  onProgressChange,
  onRemoved,
  onVenuesChanged,
}: {
  dance: Dance | null;
  userId: string;
  activeTab: string | null;
  progress?: DanceProgress;
  onClose: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  // Called after a full "remove everywhere" completes, so the parent can
  // clear this dance from progress and refresh any venue lists it was in.
  onRemoved: (danceId: string) => void;
  // Called after a venue tie is added, so My List re-reads its venue links.
  onVenuesChanged?: () => void;
}) {
  const [songSwap, setSongSwap] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapsOpen, setSwapsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Venues this dance is currently tied to, for this user — the multi-picker
  // pre-checks these and the modal lists them as chips.
  const [danceVenues, setDanceVenues] = useState<VenueOption[]>([]);
  // The user's "home bar" — pinned to the top of the chips and the picker.
  const [homeVenueId, setHomeVenueId] = useState<string | null>(null);
  // The user's own saved song swaps for this dance (separate from
  // BootStepper's catalog list above).
  const [mySwaps, setMySwaps] = useState<SongSwapEntry[]>([]);
  const [mySwapsOpen, setMySwapsOpen] = useState(false);
  const [addingSwap, setAddingSwap] = useState(false);
  // A reference video link (YouTube / TikTok / …) kept on the progress row.
  const [linkInput, setLinkInput] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  useEffect(() => {
    if (dance) {
      setSongSwap("");
      setPickerOpen(false);
      setSwapsOpen(false);
      setDanceVenues([]);
      setMySwaps([]);
      setMySwapsOpen(false);
      setLinkInput(progress?.link ?? "");
      loadDanceVenues(userId, dance.id)
        .then(setDanceVenues)
        .catch(() => {
          // Non-critical — worst case the modal just doesn't show existing
          // venue ties until reopened.
        });
      loadHomeVenueId(userId)
        .then(setHomeVenueId)
        .catch(() => {});
      loadSongSwaps(userId, dance.id)
        .then(setMySwaps)
        .catch(() => {
          // Non-critical — worst case the saved-swaps list is just empty
          // until reopened.
        });
    }
    // `dance` objects are re-created per fetch, so compare by id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dance?.id, userId]);

  if (!dance) return null;

  const choreographer = dance.choreographers?.join(", ");
  const danceState = progress?.status ?? "none";

  const showError = (err: any, fallback: string) =>
    Alert.alert("Something went wrong", err?.message ?? fallback);

  // --- COMMENTED OUT: status actions from within this modal ---------------
  // The "Save for Later / Want to learn / Learned it / Review" buttons were
  // removed from the details modal (status is set from the dance cards on
  // My List / Home instead). Left here, and the JSX block further down, so
  // they can be switched back on. To restore: uncomment this function, the
  // `<View style={s.statusButtons}>` block below, and the `saveProgress`
  // import at the top of the file — and note the venue model changed since
  // (single `venue` → `danceVenues: VenueOption[]`), so the venue-tying
  // lines here need rewriting against `handleSaveVenues`.
  //
  // Any of the three status actions: saves the status, ties the venue if
  // one was picked (best-effort — a venue hiccup shouldn't block the
  // status update, they're conceptually independent), and lets the user
  // know where to find it afterward.
  /*
  const handleStatus = async (status: LearningStatus) => {
    setSaving(true);
    let venueSaved = false;
    if (venue) {
      try {
        await saveVenueDance(userId, venue.id, dance, songSwap.trim());
        venueSaved = true;
        setDanceVenueIds((current) =>
          current.includes(venue.id) ? current : [...current, venue.id],
        );
      } catch (err: any) {
        Alert.alert(
          "Venue not saved",
          `${dance.name} will still be updated, but couldn't be tied to ${venue.name}: ${err?.message ?? "unknown error"}`,
        );
      }
    }
    try {
      // Preserve the "Shared from" attribution across every status
      // change (maybe -> want -> learned). Undefined means it's the
      // user's own dance.
      const sharedFrom = progress?.fromFriend;
      const next: DanceProgress = {
        danceId: dance.id,
        status,
        fromFriend: sharedFrom,
        danceName: dance.name,
        danceSong: dance.defaultSong,
        danceDifficulty: dance.difficulty,
        // saveProgress never touches the link column, so carry it through
        // local state too — otherwise the chip vanishes until a reload.
        link: progress?.link,
        // Keep the original "date added"; only "last updated" moves.
        createdAt: progress?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveProgress(userId, next, dance, sharedFrom, { overwrite: true });
      onProgressChange(dance.id, next);
      if (!venue && !danceState) {
        const message = `${dance.name} was added to your My List${
          venueSaved ? ` and tagged to ${venue!.name}` : ""
        }.`;

        if (Platform.OS === "web") {
          window.alert(`Saved\n\n${message}`);
        } else {
          Alert.alert("Saved", message);
        }
      }

      onClose();
    } catch (err: any) {
      showError(err, "Could not save your progress.");
    } finally {
      setSaving(false);
    }
  };
  */
  // --- END COMMENTED OUT --------------------------------------------------

  // Save from the multi-picker: diff the checked venues against the ones
  // this dance is already tied to, add the new ties, drop the unchecked
  // ones. If the dance ends up tied to a venue but has no status yet (e.g.
  // tagged straight from Home search), give it a "Save for Later" row so it
  // shows in My List — an existing status is never overwritten.
  const handleSaveVenues = async (picked: VenueOption[]) => {
    setPickerOpen(false);
    const currentIds = danceVenues.map((v) => v.id);
    const pickedIds = picked.map((v) => v.id);
    const toAdd = picked.filter((v) => !currentIds.includes(v.id));
    const toRemove = danceVenues.filter((v) => !pickedIds.includes(v.id));
    if (!toAdd.length && !toRemove.length) return;

    setSaving(true);
    try {
      for (const v of toAdd) {
        await saveVenueDance(userId, v.id, dance, "");
      }
      for (const v of toRemove) {
        await removeVenueDance(userId, v.id, dance.id);
      }
      setDanceVenues(picked);
      onVenuesChanged?.();

      let listed = false;
      if (picked.length && !progress) {
        const now = new Date().toISOString();
        const next: DanceProgress = {
          danceId: dance.id,
          status: "maybe",
          danceName: dance.name,
          danceSong: dance.defaultSong,
          danceDifficulty: dance.difficulty,
          createdAt: now,
          updatedAt: now,
        };
        listed = await saveProgress(userId, next, dance);
        if (listed) onProgressChange(dance.id, next);
      }

      if (listed) {
        Alert.alert(
          "Saved",
          `${dance.name} was tagged to ${picked.length} venue${
            picked.length === 1 ? "" : "s"
          } and saved to your list.`,
        );
      }
    } catch (err: any) {
      showError(err, "Could not save those venues.");
      // Re-sync from the server so the chips reflect what actually stuck.
      loadDanceVenues(userId, dance.id).then(setDanceVenues).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  // Saves a personal song swap to the user's own library for this dance —
  // independent of the venue flow.
  const handleAddSongSwap = async () => {
    const name = songSwap.trim();
    if (!name) return;
    setAddingSwap(true);
    try {
      await addSongSwap(userId, dance.id, name, null);
      const updated = await loadSongSwaps(userId, dance.id);
      setMySwaps(updated);
      setMySwapsOpen(true);
      setSongSwap("");
    } catch (err: any) {
      showError(err, "Could not save that song swap.");
    } finally {
      setAddingSwap(false);
    }
  };

  const handleDeleteSwap = async (id: string) => {
    try {
      await deleteSongSwap(userId, id);
      setMySwaps((current) => current.filter((entry) => entry.id !== id));
    } catch (err: any) {
      showError(err, "Could not remove that song swap.");
    }
  };

  // Saves (or clears) the reference video link on this dance's progress
  // row. Only reachable once the dance is in a list — there's no row to
  // hang the link on otherwise.
  const handleSaveLink = async () => {
    const raw = linkInput.trim();
    const url = raw
      ? /^https?:\/\//i.test(raw)
        ? raw
        : `https://${raw}`
      : null;
    setSavingLink(true);
    try {
      await setDanceLink(userId, dance.id, url);
      onProgressChange(dance.id, {
        danceId: dance.id,
        status: danceState,
        fromFriend: progress?.fromFriend,
        danceName: progress?.danceName ?? dance.name,
        danceSong: progress?.danceSong ?? dance.defaultSong,
        danceDifficulty: progress?.danceDifficulty ?? dance.difficulty,
        link: url ?? undefined,
        // A link edit isn't a status change — keep both timestamps as-is so
        // My List ordering doesn't move (setDanceLink touches neither).
        createdAt: progress?.createdAt,
        updatedAt: progress?.updatedAt,
      });
      setLinkInput(url ?? "");
    } catch (err: any) {
      showError(err, "Could not save that link.");
    } finally {
      setSavingLink(false);
    }
  };

  const handleConfirmedRemove = async () => {
    setSaving(true);

    try {
      await removeDanceEverywhere(userId, dance.id);
      onProgressChange(dance.id, null);
      onRemoved(dance.id);
      onClose();
    } catch (err: any) {
      showError(err, "Could not remove this dance.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    const message = `This removes "${dance.name}" from Want to learn, Learned, and every venue you've tagged it to. This can't be undone.`;

    if (Platform.OS === "web") {
      const confirmed = window.confirm(`Remove this dance?\n\n${message}`);

      if (confirmed) {
        await handleConfirmedRemove();
      }
    } else {
      Alert.alert("Remove this dance?", message, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: handleConfirmedRemove,
        },
      ]);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Pressable
            style={s.closeButton}
            onPress={onClose}
            disabled={saving}
            hitSlop={10}
          >
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
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

            <View style={s.tags}>
              <View style={s.statusBadge}>
                <Text style={s.statusBadgeText}>
                  {STATUS_LABEL[danceState]}
                </Text>
              </View>
              {progress?.fromFriend && progress.fromFriend !== "self" && (
                <View style={s.sharedFromBadge}>
                  <Text style={s.sharedFromText}>
                    Shared from: {progress.fromFriend}
                  </Text>
                </View>
              )}
            </View>

            {progress ? (
              <>
                <Text style={s.fieldLabel}>
                  VIDEO LINK <Text style={s.optional}>(optional)</Text>
                </Text>
                <View style={s.swapRow}>
                  <TextInput
                    value={linkInput}
                    onChangeText={setLinkInput}
                    placeholder="Paste a YouTube / TikTok link"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={s.swapInput}
                  />
                  <Pressable
                    style={[
                      s.swapAddButton,
                      linkInput.trim() === (progress.link ?? "") && s.disabled,
                    ]}
                    onPress={handleSaveLink}
                    disabled={
                      savingLink || linkInput.trim() === (progress.link ?? "")
                    }
                  >
                    <Text style={s.swapAddButtonText}>
                      {savingLink ? "…" : "✓"}
                    </Text>
                  </Pressable>
                </View>
                {progress.link ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(progress.link!).catch(() => {})
                    }
                  >
                    <Text style={s.openLink} numberOfLines={1}>
                      🎬 Open saved video
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            <Text style={s.fieldLabel}>
              VENUES <Text style={s.optional}>(optional)</Text>
            </Text>
            <Pressable
              style={s.select}
              onPress={() => setPickerOpen(true)}
              disabled={saving}
            >
              <Text style={s.selectText}>
                {saving
                  ? "Saving…"
                  : danceVenues.length
                    ? `${danceVenues.length} venue${
                        danceVenues.length === 1 ? "" : "s"
                      } — tap to change`
                    : "Add venues you dance this at"}
              </Text>
              <Text style={s.caret}>▾</Text>
            </Pressable>
            {danceVenues.length > 0 && (
              <View style={s.venueChips}>
                {homeFirst(danceVenues, homeVenueId).map((v) => (
                  <View
                    key={v.id}
                    style={[
                      s.venueChip,
                      v.id === homeVenueId && s.venueChipHome,
                    ]}
                  >
                    <Text style={s.venueChipText}>
                      {v.id === homeVenueId ? "🏠" : "📍"} {v.name}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={s.fieldLabel}>
              SONG SWAP <Text style={s.optional}>(optional)</Text>
            </Text>
            <View style={s.swapRow}>
              <TextInput
                value={songSwap}
                onChangeText={setSongSwap}
                placeholder="e.g. Shivers"
                placeholderTextColor={colors.muted}
                style={s.swapInput}
              />
              <Pressable
                style={[s.swapAddButton, !songSwap.trim() && s.disabled]}
                onPress={handleAddSongSwap}
                disabled={!songSwap.trim() || addingSwap}
              >
                <Text style={s.swapAddButtonText}>
                  {addingSwap ? "…" : "＋"}
                </Text>
              </Pressable>
            </View>

            <Text style={s.hint}>
              Saved as a swap you use for this dance.
            </Text>

            {mySwaps.length > 0 && (
              <>
                <Pressable
                  style={s.swapsToggle}
                  onPress={() => setMySwapsOpen((open) => !open)}
                >
                  <Text style={s.swapsToggleText}>
                    🔖 {mySwaps.length} saved song swap
                    {mySwaps.length > 1 ? "s" : ""}
                  </Text>
                  <Text style={s.caret}>{mySwapsOpen ? "▴" : "▾"}</Text>
                </Pressable>
                {mySwapsOpen && (
                  <View style={s.swapsList}>
                    {mySwaps.map((entry) => (
                      <View key={entry.id} style={s.mySwapRow}>
                        <Text style={[s.swapItem, s.mySwapText]}>
                          • {entry.songName}
                          {entry.venueName ? ` - ${entry.venueName}` : ""}
                        </Text>
                        <Pressable onPress={() => handleDeleteSwap(entry.id)}>
                          <Text style={s.mySwapDelete}>✕</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* COMMENTED OUT: status action buttons in this modal. Status is
                now set from the dance cards (My List / Home). "Remove from
                all lists" below stays. To restore: uncomment this block, the
                `handleStatus` function above, and the `saveProgress` import.
            <View style={s.statusButtons}>
              {danceState === "learned" && (
                <Pressable
                  style={s.tertiary}
                  onPress={() => handleStatus("want")}
                  disabled={saving}
                >
                  <Text style={s.tertiaryText}>🔁 Review</Text>
                </Pressable>
              )}
              {danceState !== "learned" && danceState !== "maybe" && (
                <Pressable
                  style={s.tertiary}
                  onPress={() => handleStatus("maybe")}
                  disabled={saving}
                >
                  <Text style={s.tertiaryText}>💭 Save for Later</Text>
                </Pressable>
              )}
              {danceState !== "want" && danceState !== "learned" && (
                <Pressable
                  style={s.secondary}
                  onPress={() => handleStatus("want")}
                  disabled={saving}
                >
                  <Text style={s.secondaryText}>♡ Want to learn</Text>
                </Pressable>
              )}
              {danceState !== "learned" && (
                <Pressable
                  style={s.primary}
                  onPress={() => handleStatus("learned")}
                  disabled={saving}
                >
                  <Text style={s.primaryText}>★ Learned it</Text>
                </Pressable>
              )}
            </View>
            */}

            {(danceState || danceVenues.length > 0) &&
              activeTab != "Home" && (
                <Pressable
                  style={s.remove}
                  onPress={handleRemove}
                  disabled={saving}
                >
                  <Text style={s.removeText}>🗑 Remove from all lists</Text>
                </Pressable>
              )}
          </ScrollView>
        </View>
      </View>

      <VenuePicker
        visible={pickerOpen}
        title="Venues for this dance"
        userId={userId}
        homeVenueId={homeVenueId}
        multi
        initialSelected={danceVenues}
        onSaveMulti={handleSaveVenues}
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
    fontSize: 27,
    fontWeight: "900",
    paddingRight: 36,
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
    justifyContent: "space-between",
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
  statusButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 20,
  },
  tags: {
    flexDirection: "row",
    justifyContent: "space-between",
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
  sharedFromBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#392746",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 14,
  },
  sharedFromText: {
    color: colors.muted,
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
    alignItems: "center",
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
  venueChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  venueChip: {
    backgroundColor: "#392746",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  venueChipHome: { borderWidth: 1, borderColor: colors.gold },
  venueChipText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  swapRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  swapInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 16,
  },
  swapAddButton: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  swapAddButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  mySwapRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  mySwapDelete: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 8,
  },
  mySwapText: {
    flex: 1,
    marginBottom: 0,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 7,
  },
  openLink: {
    color: colors.pink,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 9,
  },
  disabled: {
    opacity: 0.4,
  },
  tertiary: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 0,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tertiaryText: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
  primary: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 0,
    backgroundColor: colors.pink,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 13,
    textAlign: "center",
  },
  secondary: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 0,
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: colors.gold,
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
  remove: {
    padding: 14,
    alignItems: "center",
    marginTop: 16,
  },
  removeText: {
    color: "#ff8080",
    fontWeight: "700",
    fontSize: 13,
  },
});
