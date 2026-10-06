import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { showAlert, showError } from "../lib/alerts";
import {
  danceLimitFor,
  DANCE_LIMIT_TITLE,
  DANCE_LIMIT_MESSAGE,
} from "../lib/planLimits";
import { Tier } from "../lib/entitlements";
import { DanceCard } from "./DanceCard";
import { saveProgress } from "../services/progress";
import { LoggedDance } from "../lib/checkinSession";
import { SessionHistoryEntry } from "../services/checkinSessions";

function toDance(ld: LoggedDance): Dance {
  return {
    id: ld.danceId,
    name: ld.name,
    defaultSong: ld.song,
    difficulty: ld.difficulty ?? "Beginner",
    details: ld.details ?? "",
    songSwaps: [],
    // Only the session's saved snapshot — App.tsx's catalog resolves
    // the real BootStepper dance the same way it does everywhere else.
    snapshot: true,
  };
}

/** Dances new to the user from one tracked session — pick some or all
 *  to add to My List as "Want to Learn." Directly adapted from
 *  FriendDancesModal.tsx's picker (picked: Set<string> | null,
 *  togglePick, Select All/Import selected/Import all, dimmed+note for
 *  already-added rows) — the already-added case here covers both a
 *  dance the user added themselves since this session, AND one the
 *  autoAddNewDances preference already silently added at
 *  session-end (see DancingSessionScreen.tsx); either way `progress`
 *  is the live source of truth, so both render identically dimmed. */
export function NewToMeModal({
  userId,
  entry,
  progress,
  onProgressChange,
  tier,
  onClose,
}: {
  userId: string;
  entry: SessionHistoryEntry | null;
  progress: Record<string, DanceProgress>;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  tier?: Tier;
  onClose: () => void;
}) {
  const [importing, setImporting] = useState(false);
  // null = browsing; a Set = picking which ones to import.
  const [picked, setPicked] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (entry) setPicked(null);
  }, [entry]);

  if (!entry) return null;

  const newDances = entry.dances.filter((d) => d.newToUser);
  const alreadyMine = (danceId: string) => Boolean(progress[danceId]);
  const importable = newDances.filter((d) => !alreadyMine(d.danceId));
  const known = newDances.filter((d) => alreadyMine(d.danceId));

  const togglePick = (danceId: string) =>
    setPicked((current) => {
      const next = new Set(current ?? []);
      if (next.has(danceId)) next.delete(danceId);
      else next.add(danceId);
      return next;
    });

  /** Imports the given dances as "Want to learn." Anything already in
   *  the user's list is skipped defensively — importing shouldn't
   *  quietly overwrite a dance they've since marked learned. */
  const importDances = async (chosen: LoggedDance[]) => {
    const fresh = chosen.filter((d) => !alreadyMine(d.danceId));
    if (!fresh.length) {
      return showAlert("Nothing to import", "Every dance you picked is already in your list.");
    }

    // The tier's dance cap — only fill up to it, rather than letting a
    // bulk import quietly blow past the limit.
    const remainingSlots = Math.max(0, danceLimitFor(tier ?? "free") - Object.keys(progress).length);
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
        toImport.map(async (ld) => {
          const dance = toDance(ld);
          const now = new Date().toISOString();
          const next: DanceProgress = {
            danceId: dance.id,
            status: "want",
            danceName: dance.name,
            danceSong: dance.defaultSong,
            danceDifficulty: dance.difficulty,
            createdAt: now,
            updatedAt: now,
          };
          const imported = await saveProgress(userId, next, dance);
          if (imported) onProgressChange(dance.id, next);
          else skipped++; // raced with another device, or already there
        }),
      );

      const added = toImport.length - skipped;
      showAlert(
        added ? "Added to your list" : "Nothing new to import",
        added
          ? `${added} dance${added === 1 ? "" : "s"} now under ♡ Want to Learn.` +
              (skipped ? ` ${skipped} you already had.` : "") +
              (overLimit
                ? ` ${overLimit} more didn't fit — ${DANCE_LIMIT_MESSAGE.toLowerCase()}`
                : "")
          : "You already had every one of those.",
      );
      onClose();
    } catch (err: any) {
      showError(err, "Could not add those dances.");
    } finally {
      setImporting(false);
    }
  };

  const pickedCount = picked?.size ?? 0;

  const renderCard = (ld: LoggedDance) => {
    const mine = alreadyMine(ld.danceId);
    return (
      <DanceCard
        key={ld.danceId}
        dance={toDance(ld)}
        song={ld.song}
        progress={mine ? progress[ld.danceId] : undefined}
        note={mine ? "Already added to your list" : undefined}
        dimmed={mine}
        selected={picked && !mine ? picked.has(ld.danceId) : undefined}
        onPress={() => {
          if (picked && !mine) togglePick(ld.danceId);
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
            <Text style={s.title} numberOfLines={2}>New to you</Text>
            <Text style={s.subtitle} numberOfLines={1}>{entry.venueName}</Text>

            {importable.length > 0 && (
              <View style={s.actions}>
                {picked ? (
                  <>
                    <Pressable
                      style={[s.primaryButton, !pickedCount && s.disabled]}
                      onPress={() => importDances(importable.filter((d) => picked.has(d.danceId)))}
                      disabled={!pickedCount || importing}
                    >
                      <Text style={s.primaryText}>
                        {importing ? "Adding…" : `Add ${pickedCount || ""} selected`.trim()}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={s.ghostButton}
                      onPress={() =>
                        setPicked(
                          pickedCount === importable.length
                            ? new Set()
                            : new Set(importable.map((d) => d.danceId)),
                        )
                      }
                      disabled={importing}
                    >
                      <Text style={s.ghostText}>
                        {pickedCount === importable.length ? "Clear" : "Select all"}
                      </Text>
                    </Pressable>
                    <Pressable style={s.ghostButton} onPress={() => setPicked(null)} disabled={importing}>
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
                        {importing ? "Adding…" : `Add all ${importable.length}`}
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
            {importable.length > 0 && (
              <>
                <Text style={s.groupLabel}>NEW TO YOU · {importable.length}</Text>
                {importable.map(renderCard)}
              </>
            )}

            {known.length > 0 && (
              <>
                <Text style={[s.groupLabel, s.groupLabelSecond]}>
                  ALREADY ADDED · {known.length}
                </Text>
                {known.map(renderCard)}
              </>
            )}

            {!newDances.length && (
              <Text style={s.empty}>Nothing new this session.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 20 },
  card: { backgroundColor: "#2b1f35", borderRadius: 28, maxHeight: "88%", overflow: "hidden" },
  actions: { flexDirection: "row", gap: 8, marginBottom: 18 },
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
  importText: { color: colors.gold, fontWeight: "800", fontSize: 13, textAlign: "center" },
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
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 13, textAlign: "center" },
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
  closeButtonText: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  header: {
    paddingHorizontal: 25,
    paddingTop: 25,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  sheet: { paddingHorizontal: 25, paddingTop: 14, paddingBottom: 32 },
  title: { color: colors.ink, fontSize: 25, fontWeight: "900", paddingRight: 36 },
  subtitle: { color: colors.gold, fontSize: 13, fontWeight: "700", marginTop: 4, marginBottom: 18 },
  groupLabel: { color: colors.gold, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  groupLabelSecond: { marginTop: 18 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
