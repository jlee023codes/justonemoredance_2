import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "../styles";
import { confirmAction, showError } from "../lib/alerts";
import { Dance, DanceProgress } from "../types";
import { getDancesByIds, searchDances } from "../lib/bootstepper";
import { loadVenueDanceReports, saveVenueDance } from "../services/venues";
import { parseNotesText } from "../services/notesImport";
import { matchesDanceName, squash } from "../lib/danceListView";
import { DIFFICULTY_COLOR } from "./DanceCard";
import { LoggedDanceRow } from "./LoggedDanceRow";
import {
  ActiveSession,
  elapsedSeconds,
  endSession,
  logDanceToSession,
  queryStepCount,
  SessionSummary,
} from "../lib/checkinSession";

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** One tappable dance search result — name, a difficulty badge (same
 *  shape/colors as DanceCard's), the step-count/walls summary
 *  BootStepper already builds (dance.details, e.g. "32 count • 4
 *  wall"), and a source tag (My List / Playing here / BootStepper). */
function DanceResultRow({
  dance,
  tag,
  onPress,
  disabled,
}: {
  dance: Dance;
  tag: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable style={s.danceRow} onPress={onPress} disabled={disabled}>
      <View style={s.danceRowCopy}>
        <View style={s.danceRowTitleLine}>
          <Text style={s.danceRowText} numberOfLines={1}>{dance.name}</Text>
          <View style={[s.difficultyBadge, { borderColor: DIFFICULTY_COLOR[dance.difficulty] }]}>
            <Text style={[s.difficultyBadgeText, { color: DIFFICULTY_COLOR[dance.difficulty] }]}>
              {dance.difficulty}
            </Text>
          </View>
        </View>
        <Text style={s.danceRowSub} numberOfLines={1}>{dance.defaultSong}</Text>
        {dance.details ? (
          <Text style={s.danceRowDetails} numberOfLines={1}>{dance.details}</Text>
        ) : null}
      </View>
      <Text style={s.danceRowTag}>{tag}</Text>
    </Pressable>
  );
}

/** The active-session screen — opened by tapping the header's "Dancing
 *  In Progress" state. Logging a dance here tags it to the venue
 *  (saveVenueDance, same as the venue's own "What's Playing" add flow)
 *  so it surfaces on the venue's shared list, not just a private log. */
export function DancingSessionScreen({
  userId,
  session,
  progress,
  catalogCache,
  onSessionChange,
  onAddToMyList,
  onEnd,
  onClose,
}: {
  userId: string;
  session: ActiveSession;
  // The user's own My List, for the "pick from your list" log source.
  progress: Record<string, DanceProgress>;
  catalogCache: Record<string, Dance>;
  onSessionChange: (next: ActiveSession) => void;
  // Adds a dance to My List as "Want to Learn" — same write path as
  // every other quick-status action (App.tsx's handleQuickStatus).
  // Used for the end-of-session "add dances you didn't already have?"
  // prompt.
  onAddToMyList: (dance: Dance) => Promise<void>;
  onEnd: (summary: SessionSummary) => Promise<void>;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  // Derived from the persisted session itself, not local-only state —
  // closing and reopening this screen (or killing the app) must not
  // lose what's already been logged tonight.
  const logged = session.loggedDances;
  const [logging, setLogging] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [venueDances, setVenueDances] = useState<Dance[]>([]);
  const [bootResults, setBootResults] = useState<Dance[]>([]);
  const [showBootSearch, setShowBootSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [ending, setEnding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // The venue's own "What's Playing" list — searched alongside My List
  // so logging a dance that's already been reported here doesn't need
  // a BootStepper round-trip at all. loadVenueDanceReports only returns
  // a bare snapshot (name/song/difficulty, details: "") — enrich with
  // catalogCache first, then getDancesByIds for anything still missing,
  // same resolve pattern VenueDancesModal.tsx uses for this exact list,
  // so a dance logged from here gets full counts/walls details like
  // every other source instead of showing up blank in Stats later.
  useEffect(() => {
    let cancelled = false;
    loadVenueDanceReports(session.venueId)
      .then(async (reports) => {
        const snapshots = reports.map((r) => r.dance);
        if (cancelled) return;
        setVenueDances(snapshots.map((d) => catalogCache[d.id] ?? d));
        const needIds = snapshots.map((d) => d.id).filter((id) => !catalogCache[id]);
        if (!needIds.length) return;
        const resolved = await getDancesByIds(needIds).catch(() => []);
        if (cancelled || !resolved.length) return;
        const byId = new Map(resolved.map((d) => [d.id, d]));
        setVenueDances((current) => current.map((d) => byId.get(d.id) ?? d));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session.venueId, catalogCache]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // `now` has no direct use — it's the useState that forces this
  // component to re-render every second; elapsedSeconds reads the
  // real clock itself, not this value.
  void now;
  const elapsed = elapsedSeconds(session);

  // Local pool to search: My List + the venue's own "What's Playing"
  // list, deduped by NAME (not just id) — BootStepper's catalog can
  // have two distinct entries that share the same title (e.g. two
  // choreographers' own "Lil Bit"), and showing both as separate
  // search hits just looks like a bug to a user who only knows one
  // dance by that name. Prefer the My List entry when both a My List
  // and a venue-only dance share a name, since it carries real
  // progress status. Only searched when there's a query — no fallback
  // "browse everything" list when the box is empty.
  const localDances = useMemo(() => {
    const byName = new Map<string, Dance>();
    for (const d of venueDances) {
      const key = squash(d.name);
      if (key) byName.set(key, d);
    }
    for (const p of Object.values(progress)) {
      const d = catalogCache[p.danceId];
      if (!d) continue;
      const key = squash(d.name);
      if (key) byName.set(key, d); // My List wins ties, added last
    }
    return [...byName.values()];
  }, [progress, catalogCache, venueDances]);

  const trimmedQuery = logQuery.trim();
  const localMatches = useMemo(() => {
    if (!trimmedQuery) return [];
    return localDances.filter((d) => matchesDanceName(d.name, trimmedQuery));
  }, [localDances, trimmedQuery]);

  // BootStepper is opt-in, not automatic — only offered once a query
  // exists and nothing local matched it, and only actually searched
  // once the user taps "Search BootStepper instead."
  useEffect(() => {
    setShowBootSearch(false);
    setBootResults([]);
  }, [trimmedQuery]);

  const handleSearchBootstepper = () => {
    if (!trimmedQuery) return;
    setShowBootSearch(true);
    setSearching(true);
    searchDances(trimmedQuery)
      .then((found) => {
        setBootResults(found);
        setSearching(false);
      })
      .catch(() => setSearching(false));
  };

  const handleLogDance = async (dance: Dance) => {
    setLogging(true);
    try {
      // The dance tapped might still be a bare snapshot (details: "") —
      // e.g. a My List entry that hasn't finished resolving against
      // BootStepper yet, not just the venue-dances case already handled
      // above. Resolve it for real right here before logging, so what
      // actually gets written always has full counts/walls details
      // regardless of source or timing — fixes the same gap this
      // enrichment effect was meant to close for "Playing here," just
      // for every source at the actual moment of logging instead.
      const full = dance.snapshot
        ? (await getDancesByIds([dance.id]).catch(() => []))[0] ?? dance
        : dance;
      await saveVenueDance(userId, session.venueId, full, "");
      const next = await logDanceToSession(session, full);
      onSessionChange(next);
      setLogQuery("");
      setBootResults([]);
      setShowBootSearch(false);
    } catch (err: any) {
      showError(err, `Could not log "${dance.name}".`);
    } finally {
      setLogging(false);
    }
  };

  const handleDoneDancing = async () => {
    const confirmed = await confirmAction(
      "Done dancing?",
      "This ends your session and saves it to Stats.",
      "Done Dancing",
    );
    if (!confirmed) return;
    setEnding(true);
    try {
      // Dances logged tonight that weren't already on My List — offer to
      // add them as "Want to Learn" before closing out (not after —
      // onEnd below unmounts this screen, so anything needing session/
      // progress/catalogCache or a confirm dialog has to happen first).
      // Dedup by id (the same dance can get logged more than once in a
      // night); only ones we actually have a full Dance object for in
      // catalogCache can be added (should be all of them, since logging
      // a dance always resolves one first).
      const seen = new Set<string>();
      const newDances: Dance[] = [];
      for (const d of session.loggedDances) {
        if (progress[d.danceId] || seen.has(d.danceId)) continue;
        seen.add(d.danceId);
        const dance = catalogCache[d.danceId];
        if (dance) newDances.push(dance);
      }
      if (newDances.length) {
        const add = await confirmAction(
          `${newDances.length} ${newDances.length === 1 ? "dance was" : "dances were"} new to you tonight`,
          "Add them to your list as Want to Learn?",
          "Add to list",
        );
        if (add) {
          for (const dance of newDances) {
            await onAddToMyList(dance).catch(() => {});
          }
        }
      }

      const stepCount = await queryStepCount(session);
      const summary = await endSession(session, "manual", stepCount);
      await onEnd(summary);
    } catch (err: any) {
      showError(err, "Could not end your session.");
    } finally {
      setEnding(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.topRow}>
          <Pressable style={s.topCloseButton} onPress={onClose} hitSlop={10}>
            <Text style={s.topCloseButtonText}>✕</Text>
          </Pressable>
          <Pressable style={s.topSecondaryButton} onPress={() => setImportOpen(true)}>
            <Text style={s.topSecondaryButtonText}>📥 Import list</Text>
          </Pressable>
          <Pressable
            style={[s.topDoneButton, ending && s.disabled]}
            onPress={handleDoneDancing}
            disabled={ending}
          >
            <Text style={s.topDoneButtonText}>{ending ? "Ending…" : "✅ Done Dancing"}</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={s.venueRow}>
            <Text style={s.venueName} numberOfLines={1}>{session.venueName}</Text>
            <Text style={s.elapsedBadge}>🔴 {formatElapsed(elapsed)}</Text>
          </View>

          <TextInput
            value={logQuery}
            onChangeText={setLogQuery}
            placeholder="Search tonight's dances"
            placeholderTextColor={colors.muted}
            style={s.search}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />

          {localMatches.map((dance) => (
            <DanceResultRow
              key={dance.id}
              dance={dance}
              tag={progress[dance.id] ? "My List" : "Playing here"}
              onPress={() => handleLogDance(dance)}
              disabled={logging}
            />
          ))}

          {trimmedQuery.length > 0 && !localMatches.length && !showBootSearch && (
            <Pressable style={s.bootPrompt} onPress={handleSearchBootstepper}>
              <Text style={s.bootPromptText}>
                No local match for "{trimmedQuery}" — search BootStepper instead
              </Text>
            </Pressable>
          )}
          {showBootSearch && searching && !bootResults.length && (
            <ActivityIndicator color={colors.gold} style={s.loader} />
          )}
          {showBootSearch &&
            bootResults.map((dance) => (
              <DanceResultRow
                key={dance.id}
                dance={dance}
                tag="BootStepper"
                onPress={() => handleLogDance(dance)}
                disabled={logging}
              />
            ))}
          {showBootSearch && !searching && !bootResults.length && (
            <Text style={s.empty}>No BootStepper matches either.</Text>
          )}

          <Text style={s.sectionLabel}>TONIGHT ({logged.length})</Text>
          {!logged.length && (
            <Text style={s.empty}>Nothing logged yet — search above to add one.</Text>
          )}
          {logged.map((d, i) => (
            <LoggedDanceRow key={`${d.danceId}-${i}`} dance={d} />
          ))}
        </ScrollView>
      </KeyboardAvoidingView>

      <SessionImportModal
        visible={importOpen}
        venueId={session.venueId}
        userId={userId}
        onClose={() => setImportOpen(false)}
        onImported={async (dances) => {
          let next = session;
          for (const dance of dances) {
            next = await logDanceToSession(next, dance);
          }
          onSessionChange(next);
        }}
      />
    </Modal>
  );
}

/** Retroactive "paste tonight's list" flow — same parser as the My
 *  List Notes import (parseNotesText), but scoped to tagging this
 *  session's venue, not touching My List progress/status at all. */
function SessionImportModal({
  visible,
  venueId,
  userId,
  onClose,
  onImported,
}: {
  visible: boolean;
  venueId: string;
  userId: string;
  onClose: () => void;
  onImported: (dances: Dance[]) => void;
}) {
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [noMatch, setNoMatch] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setText("");
      setNoMatch([]);
    }
  }, [visible]);

  const handleImport = async () => {
    const parsed = parseNotesText(text);
    if (!parsed.length) return;
    setImporting(true);
    const imported: Dance[] = [];
    const missed: string[] = [];
    try {
      for (const line of parsed) {
        try {
          const found = await searchDances(line.name);
          const dance = found[0];
          if (!dance) {
            missed.push(line.name);
            continue;
          }
          await saveVenueDance(userId, venueId, dance, "");
          imported.push(dance);
        } catch {
          missed.push(line.name);
        }
      }
      if (imported.length) onImported(imported);
      setNoMatch(missed);
      if (!missed.length) onClose();
    } catch (err: any) {
      showError(err, "Could not import your list.");
    } finally {
      setImporting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.importOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.importCard}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>

          <ScrollView
            style={s.importBody}
            contentContainerStyle={s.importBodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={s.venueName}>Import tonight's list</Text>
            <Text style={s.importHint}>
              Paste the dances you did tonight — same format as a My List
              import (bullet list, checklist, or numbered list).
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Raised Like That&#10;Rude Dude&#10;Stetson"
              placeholderTextColor={colors.muted}
              style={s.importInput}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {noMatch.length > 0 && (
              <Text style={s.importMissed}>
                No match for: {noMatch.join(", ")}
              </Text>
            )}
          </ScrollView>

          <View style={s.importStickyFooter}>
            <Pressable
              style={[s.doneButton, (!text.trim() || importing) && s.disabled]}
              onPress={handleImport}
              disabled={!text.trim() || importing}
            >
              <Text style={s.doneButtonText}>{importing ? "Importing…" : "Import"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 25, paddingTop: 20, paddingBottom: 60 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  topCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  topCloseButtonText: { color: colors.muted, fontSize: 15, fontWeight: "800" },
  topSecondaryButton: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  topSecondaryButtonText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
  topDoneButton: {
    flex: 1,
    backgroundColor: colors.pink,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  topDoneButtonText: { color: "#fff", fontWeight: "900", fontSize: 13 },
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
  venueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  venueName: { color: colors.ink, fontSize: 22, fontWeight: "900", flexShrink: 1, paddingRight: 10 },
  elapsedBadge: { color: colors.gold, fontSize: 15, fontWeight: "800" },
  sectionLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 8,
  },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
  },
  loader: { marginTop: 14 },
  bootPrompt: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  bootPromptText: { color: colors.pink, fontSize: 13, fontWeight: "700" },
  danceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  danceRowCopy: { flex: 1, paddingRight: 10 },
  danceRowTitleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  danceRowText: { color: colors.ink, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  difficultyBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  difficultyBadgeText: { fontSize: 9, fontWeight: "800" },
  danceRowSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  danceRowDetails: { color: colors.gold, fontSize: 11, fontWeight: "700", marginTop: 3 },
  danceRowTag: { color: colors.muted, fontSize: 11 },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  doneButton: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  doneButtonText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  disabled: { opacity: 0.5 },
  importOverlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 20 },
  importCard: { backgroundColor: "#2b1f35", borderRadius: 28, maxHeight: "80%", paddingTop: 25 },
  importBody: { flexGrow: 0 },
  importBodyContent: { paddingHorizontal: 25, paddingBottom: 10 },
  importStickyFooter: {
    paddingHorizontal: 25,
    paddingTop: 14,
    paddingBottom: 25,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  importHint: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 8, marginBottom: 14 },
  importInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 14,
    minHeight: 140,
  },
  importMissed: { color: "#ff8080", fontSize: 12, marginTop: 10, lineHeight: 17 },
});
