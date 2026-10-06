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
import { loadDancesAlreadyAtVenue, loadVenueDanceReports, saveVenueDance } from "../services/venues";
import { parseNotesText } from "../services/notesImport";
import { matchesDanceName, squash } from "../lib/danceListView";
import { DIFFICULTY_COLOR } from "./DanceCard";
import { LoggedDanceRow } from "./LoggedDanceRow";
import { Avatar } from "./Avatar";
import {
  ActiveSession,
  elapsedSeconds,
  endSession,
  LoggedDance,
  logDanceToSession,
  queryStepCount,
  SessionSummary,
} from "../lib/checkinSession";
import {
  LiveDance,
  LiveParticipant,
  loadLiveDances,
  loadLiveParticipants,
  loadLivePercent,
  logLiveDance,
  subscribeLiveSession,
  toggleDanced,
} from "../lib/liveSession";

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
 *  wall"), and a source tag (My List / Playing here / BootStepper).
 *  `loggedByName` set means someone already logged this exact dance
 *  during tonight's session — disabled, with a note, instead of
 *  letting it be logged a second time. */
function DanceResultRow({
  dance,
  tag,
  onPress,
  disabled,
  loggedByName,
}: {
  dance: Dance;
  tag: string;
  onPress: () => void;
  disabled: boolean;
  loggedByName?: string;
}) {
  const alreadyLogged = !!loggedByName;
  return (
    <Pressable
      style={[s.danceRow, alreadyLogged && s.danceRowDisabled]}
      onPress={onPress}
      disabled={disabled || alreadyLogged}
    >
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
        {alreadyLogged ? (
          <Text style={s.danceRowAlready} numberOfLines={1}>
            {loggedByName} recorded this for tonight
          </Text>
        ) : dance.details ? (
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
  autoAddNewDances,
  onSessionChange,
  onAddToMyList,
  onCacheDances,
  onEnd,
  onClose,
}: {
  userId: string;
  session: ActiveSession;
  // The user's own My List, for the "pick from your list" log source.
  progress: Record<string, DanceProgress>;
  catalogCache: Record<string, Dance>;
  // Profile preference — if true, new-to-me dances from this session
  // are added to My List silently at session-end instead of waiting
  // for a manual pick from Stats' "New To Me" card. See
  // src/services/checkinSessions.ts's loadAutoAddNewDances.
  autoAddNewDances: boolean;
  onSessionChange: (next: ActiveSession) => void;
  // Adds a dance to My List as "Want to Learn" — same write path as
  // every other quick-status action (App.tsx's handleQuickStatus).
  // Used by the auto-add-new-dances preference at session-end.
  onAddToMyList: (dance: Dance) => Promise<void>;
  // Feeds freshly-resolved dances back into App.tsx's shared
  // catalogCache (same callback every other screen already uses —
  // see onCacheDances={mergeIntoCache} in App.tsx). Needed because
  // App.tsx's own background resolve effect can still be mid-flight
  // for a My List dance that was never individually opened before —
  // without resolving here too, that dance silently can't be found by
  // this screen's search (localDances drops any progress entry with
  // no catalogCache hit at all) until that effect gets to it on its
  // own schedule.
  onCacheDances: (dances: Dance[]) => void;
  onEnd: (summary: SessionSummary) => Promise<void>;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [logging, setLogging] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [venueDances, setVenueDances] = useState<Dance[]>([]);
  const [bootResults, setBootResults] = useState<Dance[]>([]);
  const [showBootSearch, setShowBootSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [ending, setEnding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // The shared, collaborative "TONIGHT" list — server-backed, visible
  // to everyone currently checked in at this venue, refreshed by the
  // Realtime subscription below. Always written to (solo or not), so
  // a lone session's list is just itself with one participant — no
  // special-case branch needed anywhere in this render path.
  const [liveDances, setLiveDances] = useState<LiveDance[]>([]);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);

  const refreshLive = () => {
    loadLiveDances(session.venueId, userId, session.startedAt).then(setLiveDances).catch(() => {});
    loadLiveParticipants(session.venueId).then(setParticipants).catch(() => {});
  };

  useEffect(() => {
    refreshLive();
    const unsubscribe = subscribeLiveSession(session.venueId, refreshLive);
    // Someone ending their own session doesn't emit any dance/mark
    // event the subscription above would catch — a plain poll is the
    // simplest way for "N dancing here now" to notice they left,
    // same foreground-interval pattern already used elsewhere in this
    // app (App.tsx's geofence check) rather than widening who can see
    // whose check-in timing via RLS/Realtime.
    const pollTimer = setInterval(refreshLive, 15000);
    return () => {
      unsubscribe();
      clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.venueId, userId]);

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

  // Resolves any My List dance this screen can't yet find in
  // catalogCache (missing entirely, or still a bare snapshot) — don't
  // just wait on App.tsx's own background resolve effect, which can
  // still be mid-flight (e.g. right after sign-in, or for a dance
  // added but never individually opened) and has no awareness this
  // screen is actively trying to search for it right now. Without
  // this, localDances below silently drops any such dance from
  // search entirely until that other effect eventually gets to it.
  useEffect(() => {
    const needIds = Object.keys(progress).filter((id) => {
      const cached = catalogCache[id];
      return !cached || cached.snapshot;
    });
    if (!needIds.length) return;
    let cancelled = false;
    getDancesByIds(needIds)
      .then((dances) => {
        if (!cancelled && dances.length) onCacheDances(dances);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, catalogCache]);

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

  // Who already logged each dance tonight, keyed the same way
  // everything else in this screen dedupes across sources — by
  // squashed name, not id, since BootStepper can resolve the "same"
  // dance to slightly different ids from different lookups.
  const loggedTonightByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of liveDances) {
      const key = squash(d.name);
      if (key) map.set(key, d.loggedBy === userId ? "you" : d.loggedByName);
    }
    return map;
  }, [liveDances]);

  // Falls back to BootStepper automatically once nothing local
  // matches the query — no extra tap. Debounced so it doesn't fire on
  // every keystroke while localMatches is still catching up, and
  // skipped entirely once a local match already exists (the common
  // case: most dances tonight are already on My List or the venue's
  // own "Playing here" list).
  useEffect(() => {
    setShowBootSearch(false);
    setBootResults([]);
    if (!trimmedQuery || localMatches.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setShowBootSearch(true);
      setSearching(true);
      searchDances(trimmedQuery)
        .then((found) => {
          if (!cancelled) setBootResults(found);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, localMatches.length]);

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
      // Shared live write — additive, own try/catch so a failure here
      // never blocks the already-working local/venue-tag writes above.
      logLiveDance(session.checkinId, session.venueId, full, userId)
        .then(refreshLive)
        .catch(() => {});
      setLogQuery("");
      setBootResults([]);
      setShowBootSearch(false);
    } catch (err: any) {
      showError(err, `Could not log "${dance.name}".`);
    } finally {
      setLogging(false);
    }
  };

  const handleToggleDanced = (liveDance: LiveDance) => {
    // Optimistic local flip — the realtime subscription's own refetch
    // will reconcile shortly after, same debounced-refetch approach
    // used everywhere else in this screen rather than hand-patching.
    setLiveDances((current) =>
      current.map((d) =>
        d.id === liveDance.id
          ? {
              ...d,
              dancedByMe: !d.dancedByMe,
              dancedCount: d.dancedCount + (d.dancedByMe ? -1 : 1),
            }
          : d,
      ),
    );
    toggleDanced(liveDance.id, session.venueId, userId, liveDance.dancedByMe)
      .then(refreshLive)
      .catch(() => refreshLive());
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
      const stepCount = await queryStepCount(session);
      const endedAt = new Date().toISOString();
      const livePercent = await loadLivePercent(
        session.venueId,
        userId,
        session.startedAt,
        endedAt,
      ).catch(() => null);
      // The full collaborative pool, not just what this user tapped to
      // log themselves — Stats should show the whole night's setlist
      // (every dance anyone logged this session), each flagged `danced`
      // by this user's own marks, not only this user's own log entries.
      const finalLiveDances = await loadLiveDances(session.venueId, userId, session.startedAt).catch(
        () => liveDances,
      );
      // "New to the venue" (nobody tagged this dance here before this
      // session started) and "new to me" (wasn't already on My List)
      // — snapshotted once here rather than recomputed later, same as
      // `danced`, so a past Stats card stays stable. No in-the-moment
      // popup for new-to-me anymore (it was lost entirely if the app
      // closed before answering) — Stats' "New To Me" card is the
      // permanent, always-available replacement; see handleDoneDancing's
      // former confirmAction block, removed in favor of that + the
      // autoAddNewDances preference below.
      const danceIds = finalLiveDances.map((d) => d.danceId);
      const alreadyAtVenue = await loadDancesAlreadyAtVenue(
        session.venueId,
        danceIds,
        session.startedAt,
      ).catch(() => new Set<string>());
      const finalDances: LoggedDance[] = finalLiveDances.map((d) => ({
        danceId: d.danceId,
        name: d.name,
        song: d.song ?? "",
        details: d.details,
        loggedAt: d.loggedAt,
        difficulty: d.difficulty,
        danced: d.dancedByMe,
        newToVenue: !alreadyAtVenue.has(d.danceId),
        newToUser: !progress[d.danceId],
      }));

      if (autoAddNewDances) {
        const seen = new Set<string>();
        for (const d of finalDances) {
          if (!d.newToUser || seen.has(d.danceId)) continue;
          seen.add(d.danceId);
          const dance = catalogCache[d.danceId];
          if (dance) await onAddToMyList(dance).catch(() => {});
        }
      }

      const summary = await endSession(session, "manual", stepCount, livePercent, finalDances);
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

          {participants.length > 1 && (
            <View style={s.participantStrip}>
              {participants.slice(0, 6).map((p) => (
                <View key={p.userId} style={s.participantAvatar}>
                  <Avatar avatarUrl={p.avatarUrl} label={p.name} size={26} />
                </View>
              ))}
              <Text style={s.participantText}>
                {participants.length} dancing here now
              </Text>
            </View>
          )}

          <TextInput
            value={logQuery}
            onChangeText={setLogQuery}
            placeholder="Log Tonight's Dances"
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
              loggedByName={loggedTonightByName.get(squash(dance.name))}
            />
          ))}

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
                loggedByName={loggedTonightByName.get(squash(dance.name))}
              />
            ))}
          {showBootSearch && !searching && !bootResults.length && (
            <Text style={s.empty}>No BootStepper matches either.</Text>
          )}

          <Text style={s.sectionLabel}>TONIGHT ({liveDances.length})</Text>
          {!liveDances.length && (
            <Text style={s.empty}>Nothing logged yet — search above to add one.</Text>
          )}
          {liveDances.map((d) => (
            <LoggedDanceRow
              key={d.id}
              dance={{
                danceId: d.danceId,
                name: d.name,
                song: d.song ?? "",
                details: d.details,
                loggedAt: d.loggedAt,
                difficulty: d.difficulty,
              }}
              loggedByName={participants.length > 1 ? d.loggedByName : undefined}
              dancedCount={participants.length > 1 ? d.dancedCount : undefined}
              dancedByMe={d.dancedByMe}
              onToggleDanced={participants.length > 1 ? () => handleToggleDanced(d) : undefined}
            />
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
  participantStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  participantAvatar: { marginRight: -8, borderWidth: 2, borderColor: colors.bg, borderRadius: 15 },
  participantText: { color: colors.muted, fontSize: 12, fontWeight: "700", marginLeft: 14 },
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
  danceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  danceRowDisabled: { opacity: 0.5 },
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
  danceRowAlready: { color: colors.muted, fontSize: 11, fontStyle: "italic", marginTop: 3 },
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
