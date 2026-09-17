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
import { showAlert, showError } from "../lib/alerts";
import { currentAward } from "../lib/awards";
import {
  FREE_DANCE_LIMIT,
  DANCE_LIMIT_TITLE,
  DANCE_LIMIT_MESSAGE,
} from "../lib/planLimits";
import { DanceCard } from "./DanceCard";
import {
  Friend,
  FriendDance,
  loadFriendDances,
  loadProfileMeta,
  ProfileMeta,
} from "../services/friends";
import { loadHomeVenueId, loadVenueById } from "../services/venues";
import { saveProgress } from "../services/progress";

function toDance(fd: FriendDance): Dance {
  return {
    id: fd.danceId,
    name: fd.name,
    defaultSong: fd.song,
    difficulty: fd.difficulty,
    details: "",
    songSwaps: [],
    // Only the friend's saved name/song/difficulty — the real BootStepper
    // details get filled in by App.tsx once the dance is in `progress`.
    snapshot: true,
  };
}

function toProgress(fd: FriendDance): DanceProgress {
  return { danceId: fd.danceId, status: fd.status };
}

export function FriendDancesModal({
  userId,
  friend,
  progress,
  onClose,
  onProgressChange,
  isPremium,
}: {
  userId: string;
  friend: Friend | null;
  /** The viewer's own list, so dances they already have can be marked and
   *  left out of the selection instead of silently no-op'ing on import. */
  progress: Record<string, DanceProgress>;
  onClose: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  /** Free tier caps My List at FREE_DANCE_LIMIT dances — import stops
   *  filling once it's hit rather than silently going over. */
  isPremium?: boolean;
}) {
  const [dances, setDances] = useState<FriendDance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  // null = browsing; a Set = picking which ones to import.
  const [picked, setPicked] = useState<Set<string> | null>(null);

  // Their "fun facts" — favorite dance / dancer since (free text) and home
  // bar (a venue name lookup). Read-only here; only editable on your own
  // Profile. Best-effort: a hiccup just leaves these blank, not an error.
  const [meta, setMeta] = useState<ProfileMeta | null>(null);
  const [homeBarName, setHomeBarName] = useState<string | null>(null);

  useEffect(() => {
    if (!friend) return;
    setMeta(null);
    setHomeBarName(null);
    loadProfileMeta(friend.id).then(setMeta).catch(() => {});
    loadHomeVenueId(friend.id)
      .then((venueId) => (venueId ? loadVenueById(venueId) : null))
      .then((venue) => setHomeBarName(venue?.name ?? null))
      .catch(() => {});
  }, [friend]);

  useEffect(() => {
    if (!friend) return;
    setLoading(true);
    setError("");
    setPicked(null);
    loadFriendDances(friend.id)
      .then(setDances)
      .catch((err: any) =>
        setError(err.message ?? "Could not load their list."),
      )
      .finally(() => setLoading(false));
  }, [friend]);

  if (!friend) return null;

  const alreadyMine = (danceId: string) => Boolean(progress[danceId]);
  const importable = dances.filter((fd) => !alreadyMine(fd.danceId));

  const togglePick = (danceId: string) =>
    setPicked((current) => {
      const next = new Set(current ?? []);
      if (next.has(danceId)) next.delete(danceId);
      else next.add(danceId);
      return next;
    });

  /** Imports the given dances as "Want to learn", tagged with whose list
   *  they came from. Anything already in the user's list is skipped —
   *  importing shouldn't quietly overwrite a dance they've marked learned. */
  const importDances = async (chosen: FriendDance[]) => {
    const fresh = chosen.filter((fd) => !alreadyMine(fd.danceId));
    if (!fresh.length) {
      return showAlert(
        "Nothing to import",
        "Every dance you picked is already in your list.",
      );
    }

    // Free tier caps My List at FREE_DANCE_LIMIT — only fill up to it,
    // rather than letting a bulk import quietly blow past the limit.
    const remainingSlots = isPremium
      ? fresh.length
      : Math.max(0, FREE_DANCE_LIMIT - Object.keys(progress).length);
    const overLimit = fresh.length - remainingSlots;
    const toImport = fresh.slice(0, remainingSlots);

    if (!toImport.length) {
      showAlert(DANCE_LIMIT_TITLE, DANCE_LIMIT_MESSAGE);
      return;
    }

    setImporting(true);
    try {
      let skipped = 0;
      await Promise.all(
        toImport.map(async (friendDance) => {
          const dance = toDance(friendDance);
          const now = new Date().toISOString();
          const next: DanceProgress = {
            danceId: dance.id,
            status: "want",
            fromFriend: friend.username,
            danceName: dance.name,
            danceSong: dance.defaultSong,
            danceDifficulty: dance.difficulty,
            // First time in the list = now; mirrors the DB row's created_at.
            createdAt: now,
            updatedAt: now,
          };
          const imported = await saveProgress(
            userId,
            next,
            dance,
            friend.username,
          );
          if (imported) onProgressChange(dance.id, next);
          else skipped++; // raced with another device, or already there
        }),
      );

      const added = toImport.length - skipped;
      showAlert(
        added ? "Added to your list" : "Nothing new to import",
        added
          ? `${added} dance${added === 1 ? "" : "s"} from ${friend.displayName} ${
              added === 1 ? "is" : "are"
            } now under ♡ Want to Learn.` +
              (skipped ? ` ${skipped} you already had.` : "") +
              (overLimit
                ? ` ${overLimit} more didn't fit — ${DANCE_LIMIT_MESSAGE.toLowerCase()}`
                : "")
          : "You already had every one of those.",
      );
      onClose();
    } catch (err: any) {
      showError(err, "Could not import your friend's list.");
    } finally {
      setImporting(false);
    }
  };

  const pickedCount = picked?.size ?? 0;
  const known = dances.filter((fd) => alreadyMine(fd.danceId));
  const hasFunFacts = Boolean(
    meta?.favoriteDance || meta?.dancerSince || homeBarName || meta?.firstDance,
  );
  const friendAward = currentAward(
    dances.filter((fd) => fd.status === "learned").length,
  );

  const renderCard = (fd: FriendDance) => {
    const mine = alreadyMine(fd.danceId);
    return (
      <DanceCard
        key={fd.danceId}
        dance={toDance(fd)}
        song={fd.song}
        progress={toProgress(fd)}
        fromFriend={friend.displayName}
        note={mine ? "Already in your list" : undefined}
        dimmed={mine}
        selected={picked && !mine ? picked.has(fd.danceId) : undefined}
        onPress={() => {
          if (picked && !mine) togglePick(fd.danceId);
        }}
      />
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
          <View style={s.header}>
            <Text style={s.title}>
              {friend.displayName}'s list
              {friendAward && (
                <Text
                  style={s.titleAward}
                  accessibilityLabel={`${friendAward.title} award`}
                >
                  {" "}
                  {friendAward.icon}
                </Text>
              )}
            </Text>
            <Text style={s.subtitle}>
              {picked
                ? "Tap dances to pick the ones you want."
                : "Read-only — this is their My List"}
            </Text>

            {hasFunFacts && (
              <View style={s.factsRow}>
                {meta?.favoriteDance && (
                  <View style={s.factPill}>
                    <Text style={s.factPillLabel}>Favorite dance</Text>
                    <Text style={s.factPillValue}>{meta.favoriteDance}</Text>
                  </View>
                )}
                {meta?.dancerSince && (
                  <View style={s.factPill}>
                    <Text style={s.factPillLabel}>Dancing since</Text>
                    <Text style={s.factPillValue}>{meta.dancerSince}</Text>
                  </View>
                )}
                {homeBarName && (
                  <View style={s.factPill}>
                    <Text style={s.factPillLabel}>Home bar</Text>
                    <Text style={s.factPillValue}>{homeBarName}</Text>
                  </View>
                )}
                {meta?.firstDance && (
                  <View style={s.factPill}>
                    <Text style={s.factPillLabel}>First learned</Text>
                    <Text style={s.factPillValue}>{meta.firstDance}</Text>
                  </View>
                )}
              </View>
            )}

            {!loading && importable.length > 0 && (
              <View style={s.actions}>
                {picked ? (
                  <>
                    <Pressable
                      style={[s.primaryButton, !pickedCount && s.disabled]}
                      onPress={() =>
                        importDances(
                          importable.filter((fd) => picked.has(fd.danceId)),
                        )
                      }
                      disabled={!pickedCount || importing}
                    >
                      <Text style={s.primaryText}>
                        {importing
                          ? "Importing…"
                          : `Import ${pickedCount || ""} selected`.trim()}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={s.ghostButton}
                      onPress={() =>
                        setPicked(
                          pickedCount === importable.length
                            ? new Set()
                            : new Set(importable.map((fd) => fd.danceId)),
                        )
                      }
                      disabled={importing}
                    >
                      <Text style={s.ghostText}>
                        {pickedCount === importable.length
                          ? "Clear"
                          : "Select all"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={s.ghostButton}
                      onPress={() => setPicked(null)}
                      disabled={importing}
                    >
                      <Text style={s.ghostText}>Cancel</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      style={s.importButton}
                      onPress={() => importDances(importable)}
                      disabled={importing}
                    >
                      <Text style={s.importText}>
                        {importing
                          ? "Importing…"
                          : `Import all ${importable.length}`}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={s.importButton}
                      onPress={() => setPicked(new Set())}
                      disabled={importing}
                    >
                      <Text style={s.importText}>Select dances</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </View>
          <ScrollView contentContainerStyle={s.sheet}>
            {loading && (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            )}
            {error ? <Text style={s.error}>{error}</Text> : null}

            {!loading && importable.length > 0 && (
              <>
                <Text style={s.groupLabel}>
                  NEW TO YOU · {importable.length}
                </Text>
                {importable.map(renderCard)}
              </>
            )}

            {!loading && known.length > 0 && (
              <>
                <Text style={[s.groupLabel, s.groupLabelSecond]}>
                  ALREADY IN YOUR LIST · {known.length}
                </Text>
                {known.map(renderCard)}
              </>
            )}

            {!loading && !dances.length && !error && (
              <Text style={s.empty}>
                {friend.displayName} hasn't marked any dances yet.
              </Text>
            )}
            {!loading && dances.length > 0 && !importable.length && (
              <Text style={s.empty}>
                You already have every dance on their list.
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
  actions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  importButton: {
    flex: 1,
    minWidth: 0,
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  importText: {
    color: colors.gold,
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
  primaryButton: {
    flex: 1,
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
  ghostButton: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: { color: colors.muted, fontWeight: "800", fontSize: 12 },
  disabled: { opacity: 0.4 },
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
  header: {
    paddingHorizontal: 25,
    paddingTop: 25,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  sheet: {
    paddingHorizontal: 25,
    paddingTop: 14,
    paddingBottom: 32,
  },
  title: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    paddingRight: 36,
  },
  titleAward: { fontSize: 20 },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 18,
  },
  loader: {
    marginTop: 20,
  },
  factsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
    marginBottom: 16,
  },
  factPill: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: "#00000030",
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  factPillLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  factPillValue: { color: colors.ink, fontSize: 12, fontWeight: "700", marginTop: 1 },
  groupLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  groupLabelSecond: { marginTop: 18 },
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
