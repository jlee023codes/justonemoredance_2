import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { confirmAction, showAlert, showError } from "../lib/alerts";
import {
  reachedDanceLimit,
  DANCE_LIMIT_TITLE,
  DANCE_LIMIT_MESSAGE,
} from "../lib/planLimits";
import { Tier } from "../lib/entitlements";
import { DanceCard } from "./DanceCard";
import { searchDances } from "../lib/bootstepper";
import { saveProgress, setDanceLink } from "../services/progress";
import {
  ImportItem,
  clearFinishedImport,
  finishImportItem,
  loadPendingImport,
  parseNotesText,
  queueImport,
} from "../services/notesImport";

const EXAMPLE = `Line dances (Bullet list)
- Raised Like That 
- Rude Dude https://youtube.com
- TATLO - https://youtube.com
- Stetson | https://youtube.com

OR 

Line dances (Notes app check list)
- [x] Raised Like That 
- [x] Rude Dude https://youtube.com
- [x] TATLO - https://youtube.com
- [x] Stetson | https://youtube.com

OR 

Line dances (Numbered - needs #. format)
1. Raised Like That 
2. Rude Dude https://youtube.com
3. TATLO - https://youtube.com
4. Stetson | https://youtube.com`;

type Phase = "loading" | "paste" | "bulk" | "match" | "done";

export function NotesImportModal({
  visible,
  userId,
  progress,
  onClose,
  onProgressChange,
  onCacheDances,
  tier,
}: {
  visible: boolean;
  userId: string;
  /** The user's current dances, to catch "you already have this one". */
  progress: Record<string, DanceProgress>;
  onClose: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  /** Lets a matched BootStepper dance render with full details right away. */
  onCacheDances: (dances: Dance[]) => void;
  /** The My List dance cap varies by tier. */
  tier?: Tier;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pasteText, setPasteText] = useState("");
  const [queueing, setQueueing] = useState(false);
  const [autoAcceptTop, setAutoAcceptTop] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  // Bulk import runs as one long async loop after the modal has already
  // moved past "paste" — closing the modal mid-run shouldn't make its
  // callbacks keep firing into a screen the user has navigated away from.
  const bulkCancelled = useRef(false);

  const [items, setItems] = useState<ImportItem[]>([]);
  const [index, setIndex] = useState(0);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"want" | "learned">("want");
  const [results, setResults] = useState<Dance[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against a double-tap firing two saves before the re-render.
  const busy = useRef(false);

  const parsed = useMemo(() => parseNotesText(pasteText), [pasteText]);
  const current: ImportItem | undefined = items[index];

  // Open: resume an unfinished run if there is one, otherwise start fresh.
  useEffect(() => {
    if (!visible) return;
    bulkCancelled.current = false;
    setPhase("loading");
    setPasteText("");
    setAutoAcceptTop(false);
    setItems([]);
    setIndex(0);
    loadPendingImport(userId)
      .then((pending) => {
        if (pending.length) {
          setItems(pending);
          setPhase("match");
        } else {
          setPhase("paste");
        }
      })
      .catch((err: any) => {
        showError(err, "Could not open the importer.");
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userId]);

  // Each new item reseeds the search box and the Want/Learned choice.
  useEffect(() => {
    if (!current) return;
    setQuery(current.rawName);
    setStatus(current.suggestedStatus);
  }, [current]);

  // Debounced BootStepper search for the current item.
  useEffect(() => {
    if (phase !== "match" || !query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchDances(query)
        .then((found) => {
          setResults(found.slice(0, 12));
          setSearching(false);
        })
        .catch(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, phase]);

  const close = async () => {
    bulkCancelled.current = true;
    await clearFinishedImport(userId).catch(() => {});
    onClose();
  };

  // Move to the next item *synchronously* so React batches it with the
  // progress update — otherwise the just-picked card flashes "Already in
  // your list" while the DB writes are in flight.
  const goNext = () => {
    const nextIndex = index + 1;
    if (nextIndex >= items.length) {
      setPhase("done");
      clearFinishedImport(userId).catch(() => {});
    } else {
      setResults([]);
      setSearching(true); // avoid a one-frame "No matches" before the next search
      setIndex(nextIndex);
    }
  };

  const handleQueue = async () => {
    if (!parsed.length) return;
    setQueueing(true);
    try {
      await queueImport(userId, parsed);
      const pending = await loadPendingImport(userId);
      setItems(pending);
      setIndex(0);
      setPhase("match");
    } catch (err: any) {
      showError(err, "Could not start the import.");
    } finally {
      setQueueing(false);
    }
  };

  /** "Accept top result" mode — no per-dance review. Runs the searches
   *  sequentially (not Promise.all) so it doesn't hammer BootStepper's
   *  search endpoint with 100+ concurrent requests. Anything that comes
   *  back with zero results is left pending on purpose — after this loop,
   *  reloading pending items naturally returns exactly that no-match set
   *  (everything else got marked done/skipped along the way), so it flows
   *  straight into the normal one-by-one match phase for just those. */
  const handleBulkAccept = async () => {
    if (!parsed.length) return;
    setQueueing(true);
    try {
      await queueImport(userId, parsed);
      const pending = await loadPendingImport(userId);
      setPhase("bulk");
      setBulkProgress({ done: 0, total: pending.length });

      // Tracks dances added *this run*, since `progress` (a prop) won't
      // reflect onProgressChange calls made earlier in this same loop —
      // two different pasted lines can resolve to the same BootStepper
      // dance, and that duplicate needs catching too.
      const addedThisRun = new Set(Object.keys(progress));
      let imported = 0;
      let duplicates = 0;
      let limitHit = false;

      for (let i = 0; i < pending.length; i++) {
        if (bulkCancelled.current) break;
        const item = pending[i];
        try {
          const found = await searchDances(item.rawName);
          const dance = found[0];
          if (!dance) {
            // No match — stays pending, surfaced in the match phase next.
          } else if (addedThisRun.has(dance.id)) {
            await finishImportItem(item.id, "skipped");
            duplicates++;
          } else if (reachedDanceLimit(progress, tier ?? "free")) {
            limitHit = true;
            break; // leave this item + the rest pending, stop importing
          } else {
            const now = new Date().toISOString();
            const next: DanceProgress = {
              danceId: dance.id,
              status: item.suggestedStatus,
              danceName: dance.name,
              danceSong: dance.defaultSong,
              danceDifficulty: dance.difficulty,
              link: item.rawLink,
              createdAt: now,
              updatedAt: now,
            };
            onCacheDances([dance]);
            onProgressChange(dance.id, next);
            addedThisRun.add(dance.id);
            await saveProgress(userId, next, dance);
            if (item.rawLink) {
              await setDanceLink(userId, dance.id, item.rawLink, "user").catch(() => {});
            }
            await finishImportItem(item.id, "done");
            imported++;
          }
        } catch {
          // A single search/save failure shouldn't kill the whole run —
          // leave that item pending, same as a genuine no-match.
        }
        if (bulkCancelled.current) break;
        setBulkProgress({ done: i + 1, total: pending.length });
      }

      if (bulkCancelled.current) return;

      await clearFinishedImport(userId).catch(() => {});
      const remaining = await loadPendingImport(userId);
      setItems(remaining);
      setIndex(0);

      // Always state every count explicitly, even at zero — omitting a
      // zero-value line (e.g. no duplicates) reads as a dangling/missing
      // stat rather than "there were none."
      const parts = [
        `${imported} dance${imported === 1 ? "" : "s"} imported.`,
        `${duplicates} already in your list (skipped).`,
      ];
      if (!limitHit) {
        parts.push(
          remaining.length
            ? `${remaining.length} had no match — let's find those now.`
            : "0 had no match.",
        );
      } else {
        parts.push(
          `\n\nYou reached your free-tier limit. ${remaining.length} dance${remaining.length === 1 ? "" : "s"} are still waiting — upgrade to keep importing.`,
        );
      }
      showAlert(imported ? "Import complete" : "Nothing new to import", parts.join(" "));

      setPhase(remaining.length ? "match" : "done");
    } catch (err: any) {
      showError(err, "Could not start the import.");
      setPhase("paste");
    } finally {
      setQueueing(false);
    }
  };

  const handleSkip = () => {
    const item = current;
    if (!item || busy.current) return;
    goNext();
    finishImportItem(item.id, "skipped").catch(() => {});
  };

  const handleChoose = async (dance: Dance) => {
    const item = current;
    if (!item || busy.current) return;
    busy.current = true;

    const existing = progress[dance.id];
    if (existing) {
      busy.current = false;
      const skip = await confirmAction(
        "Already in your list",
        `You already have "${existing.danceName ?? dance.name}". Skip it and move to the next?`,
        "Skip it",
      );
      if (skip) {
        goNext();
        finishImportItem(item.id, "skipped").catch(() => {});
      }
      return; // otherwise: stay put so they can pick a different match
    }

    if (reachedDanceLimit(progress, tier ?? "free")) {
      busy.current = false;
      showAlert(DANCE_LIMIT_TITLE, DANCE_LIMIT_MESSAGE);
      return; // stay put — this item is still in the queue to retry later
    }

    const now = new Date().toISOString();
    const next: DanceProgress = {
      danceId: dance.id,
      status,
      danceName: dance.name,
      danceSong: dance.defaultSong,
      danceDifficulty: dance.difficulty,
      link: item.rawLink,
      // First time in the list = now; mirrors the DB row's created_at.
      createdAt: now,
      updatedAt: now,
    };
    // Update the app + advance now; persist in the background.
    onCacheDances([dance]);
    onProgressChange(dance.id, next);
    goNext();
    busy.current = false;

    try {
      await saveProgress(userId, next, dance);
      if (item.rawLink) {
        await setDanceLink(userId, dance.id, item.rawLink, "user").catch(
          () => {},
        );
      }
      await finishImportItem(item.id, "done");
    } catch (err: any) {
      onProgressChange(dance.id, null); // roll back the optimistic add
      showError(
        err,
        `"${dance.name}" didn't save — it's still in your import.`,
      );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={close} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>

          {phase === "loading" && (
            <View style={s.centered}>
              <ActivityIndicator color={colors.gold} />
            </View>
          )}

          {phase === "paste" && (
            <>
              <ScrollView
                style={s.pasteBody}
                contentContainerStyle={s.sheet}
                keyboardShouldPersistTaps="handled"
              >
              <Text style={s.title}>Import Your List</Text>
              <Text style={s.subtitle}>
                From your your Notes app (or spreadsheet, etc) select the dances
                and copy them. Paste them below (a checklist, bullet list or
                numbered list all work).
                {"\n"}You can also bring in a demo/tutorial link if its in your
                list already. See examples below.
              </Text>

              <TextInput
                value={pasteText}
                onChangeText={setPasteText}
                placeholder={EXAMPLE}
                placeholderTextColor={colors.muted}
                style={s.paste}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {parsed.length > 0 && (
                <>
                  <Text style={s.foundLabel}>
                    {parsed.length} dance{parsed.length === 1 ? "" : "s"} found
                  </Text>
                  <View style={s.previewList}>
                    {parsed.map((line, i) => (
                      <View key={`${line.name}-${i}`} style={s.previewRow}>
                        <Text style={s.previewName} numberOfLines={1}>
                          {line.checked ? "★ " : ""}
                          {line.name}
                        </Text>
                        {line.link && (
                          <Text style={s.previewLink} numberOfLines={1}>
                            🔗 {line.link.replace(/^https?:\/\//, "")}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                </>
              )}

              </ScrollView>

              <View style={s.stickyFooter}>
                {parsed.length > 0 && (
                  <View style={s.checkboxRow}>
                    <Pressable
                      style={s.checkboxToggle}
                      onPress={() => setAutoAcceptTop((v) => !v)}
                      hitSlop={4}
                    >
                      <View style={[s.checkbox, autoAcceptTop && s.checkboxOn]}>
                        {autoAcceptTop && <Text style={s.checkboxMark}>✓</Text>}
                      </View>
                      <Text style={s.checkboxLabel}>
                        Accept top result for each dance.
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        showAlert(
                          "Accept top result",
                          "Skips one-by-one review — best for long lists. Anything with no match still comes to you to match by hand.",
                        )
                      }
                      hitSlop={8}
                    >
                      <Text style={s.infoIcon}>ⓘ</Text>
                    </Pressable>
                  </View>
                )}

                <Pressable
                  style={[s.primary, !parsed.length && s.disabled]}
                  onPress={autoAcceptTop ? handleBulkAccept : handleQueue}
                  disabled={!parsed.length || queueing}
                >
                  <Text style={s.primaryText}>
                    {queueing
                      ? "Starting…"
                      : !parsed.length
                        ? "Paste your list above"
                        : autoAcceptTop
                          ? `Auto-import ${parsed.length} dance${parsed.length === 1 ? "" : "s"}`
                          : `Match ${parsed.length} dance${parsed.length === 1 ? "" : "s"}`}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {phase === "bulk" && (
            <View style={s.sheet}>
              <Text style={s.title}>Importing your list…</Text>
              <Text style={s.subtitle}>
                Matching {bulkProgress.done} of {bulkProgress.total} dances.
                Anything with no clean match will come back to you next.
              </Text>
              <ActivityIndicator color={colors.gold} style={s.loader} />
            </View>
          )}

          {phase === "match" && current && (
            <ScrollView
              contentContainerStyle={s.sheet}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.counter}>
                Dance {index + 1} of {items.length}
                {index > 0 ? ` · ${index} handled` : ""}
              </Text>
              <Text style={s.title} numberOfLines={2}>
                {current.rawName}
              </Text>
              {current.rawLink && (
                <Text style={s.linkChip} numberOfLines={1}>
                  🔗 {current.rawLink.replace(/^https?:\/\//, "")}
                </Text>
              )}
              <View style={s.statusRow}>
                <Pressable style={s.statusButton} onPress={handleSkip}>
                  <Text style={s.skipText}>Skip</Text>
                </Pressable>
                <Pressable style={s.statusButton} onPress={close}>
                  <Text style={s.laterText}>That's all for now</Text>
                </Pressable>
              </View>

              <Text style={s.fieldLabel}>SEARCH BOOTSTEPPER</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Dance name"
                placeholderTextColor={colors.muted}
                style={s.search}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={s.statusRow}>
                {(["want", "learned"] as const).map((option) => (
                  <Pressable
                    key={option}
                    style={[
                      s.statusButton,
                      status === option && s.statusButtonOn,
                    ]}
                    onPress={() => setStatus(option)}
                  >
                    <Text
                      style={[
                        s.statusButtonText,
                        status === option && s.statusButtonTextOn,
                      ]}
                    >
                      {option === "want" ? "♡ Want to learn" : "★ Learned"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={s.fieldLabel}>PICK THE MATCH</Text>
              {searching && !results.length && (
                <ActivityIndicator color={colors.gold} style={s.loader} />
              )}
              {results.map((dance) => (
                <DanceCard
                  key={dance.id}
                  dance={dance}
                  song={dance.defaultSong}
                  progress={progress[dance.id]}
                  note={progress[dance.id] ? "Already in your list" : undefined}
                  onPress={() => handleChoose(dance)}
                />
              ))}
              {!searching && !results.length && (
                <Text style={s.empty}>
                  No matches for “{query.trim()}”. Line dance name or song name
                  not found. Please make sure you're looking for either the
                  dance name OR song name.
                </Text>
              )}
            </ScrollView>
          )}

          {phase === "done" && (
            <View style={s.sheet}>
              <Text style={s.title}>All caught up 🎉</Text>
              <Text style={s.subtitle}>
                Every dance from your note has been matched or skipped.
              </Text>
              <Pressable style={s.primary} onPress={close}>
                <Text style={s.primaryText}>Done</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
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
  centered: { padding: 60, alignItems: "center" },
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
  sheet: { padding: 25, paddingBottom: 20 },
  // ScrollView itself (not contentContainerStyle) — flexGrow: 0 stops it
  // from expanding past its content, so within the card's maxHeight it
  // only takes what it needs and the footer below always stays put
  // instead of getting pushed off-screen by a long preview list. Same
  // pattern as MyListToolsModal's `body` style.
  pasteBody: { flexGrow: 0 },
  stickyFooter: {
    paddingHorizontal: 25,
    paddingTop: 14,
    paddingBottom: 25,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: "#2b1f35",
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "900",
    paddingRight: 36,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 18,
  },
  counter: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 8,
  },
  paste: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 14,
    minHeight: 150,
  },
  foundLabel: {
    color: colors.green,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 14,
  },
  previewList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    overflow: "hidden",
  },
  previewRow: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  previewName: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  previewLink: { color: colors.muted, fontSize: 11, marginTop: 2 },
  linkChip: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  fieldLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 18,
    marginBottom: 7,
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
  statusRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  statusButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  statusButtonOn: { borderColor: colors.pink, backgroundColor: "#3a1f30" },
  statusButtonText: { color: colors.muted, fontWeight: "800", fontSize: 12 },
  statusButtonTextOn: { color: colors.pink },
  loader: { marginTop: 16 },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 16,
  },
  checkboxToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  infoIcon: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  checkboxMark: { color: "#fff", fontSize: 13, fontWeight: "900" },
  checkboxLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 17,
  },
  primary: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 20,
  },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  disabled: { opacity: 0.4 },
  skip: { padding: 14, alignItems: "center", marginTop: 10 },
  skipText: { color: colors.muted, fontWeight: "800", fontSize: 13 },
  later: { padding: 10, alignItems: "center" },
  laterText: { color: colors.gold, fontWeight: "800", fontSize: 13 },
});
