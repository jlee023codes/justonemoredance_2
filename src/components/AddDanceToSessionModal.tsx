import { useEffect, useState } from "react";
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
import { colors } from "../styles";
import { showError } from "../lib/alerts";
import { Dance } from "../types";
import { searchDances } from "../lib/bootstepper";
import { DIFFICULTY_COLOR } from "./DanceCard";
import { ProgressBar } from "./ProgressBar";
import { parseNotesText } from "../services/notesImport";
import { addManualDanceToSession, SessionHistoryEntry } from "../services/checkinSessions";

type Mode = "individual" | "bulk";

/** A forgotten dance (or several), added to an already-ended session
 *  from Stats — "＋ Add a dance" on a past session card. Two modes:
 *   - individual: search-as-you-type, tap a result to add it, same
 *     flow as before.
 *   - bulk: paste a list (same parser as every other paste-import in
 *     this app — bullets, checklists, numbered lists, or just one
 *     name per line) and auto-add the first/most relevant BootStepper
 *     match for each line, same "first result wins" convention
 *     SessionImportModal/AddPastNightModal already use, so you don't
 *     have to search-and-tap one at a time for a whole forgotten set.
 *  Keyboard-safe shell per the established pattern throughout this
 *  app (KeyboardAvoidingView, scrollable body, sticky footer for the
 *  bulk mode's single submit action). */
export function AddDanceToSessionModal({
  entry,
  onClose,
  onAdded,
}: {
  entry: SessionHistoryEntry | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<Mode>("individual");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Dance[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const [bulkText, setBulkText] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkMissed, setBulkMissed] = useState<string[]>([]);

  useEffect(() => {
    if (entry) {
      setMode("individual");
      setQuery("");
      setResults([]);
      setBulkText("");
      setBulkMissed([]);
      setBulkProgress({ done: 0, total: 0 });
    }
  }, [entry]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchDances(trimmedQuery)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const handleAdd = async (dance: Dance) => {
    if (!entry) return;
    setAddingId(dance.id);
    try {
      await addManualDanceToSession(entry.id, dance);
      onAdded();
      onClose();
    } catch (err: any) {
      showError(err, `Could not add "${dance.name}".`);
    } finally {
      setAddingId(null);
    }
  };

  const handleBulkAdd = async () => {
    if (!entry) return;
    const parsed = parseNotesText(bulkText);
    if (!parsed.length) return;
    setBulkImporting(true);
    setBulkProgress({ done: 0, total: parsed.length });
    const missed: string[] = [];
    let addedAny = false;
    try {
      for (let i = 0; i < parsed.length; i++) {
        const line = parsed[i];
        const found = await searchDances(line.name).catch(() => []);
        const dance = found[0];
        if (!dance) {
          missed.push(line.name);
        } else {
          await addManualDanceToSession(entry.id, dance);
          addedAny = true;
        }
        setBulkProgress({ done: i + 1, total: parsed.length });
      }
      if (addedAny) onAdded();
      setBulkMissed(missed);
      if (!missed.length) onClose();
    } catch (err: any) {
      showError(err, "Could not add those dances.");
    } finally {
      setBulkImporting(false);
    }
  };

  if (!entry) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>

          <View style={s.headerArea}>
            <Text style={s.title}>Add a missed dance</Text>
            <Text style={s.subtitle} numberOfLines={1}>{entry.venueName}</Text>

            <View style={s.modeRow}>
              <Pressable
                style={[s.modeTab, mode === "individual" && s.modeTabActive]}
                onPress={() => setMode("individual")}
              >
                <Text style={[s.modeTabText, mode === "individual" && s.modeTabTextActive]}>
                  Enter individually
                </Text>
              </Pressable>
              <Pressable
                style={[s.modeTab, mode === "bulk" && s.modeTabActive]}
                onPress={() => setMode("bulk")}
              >
                <Text style={[s.modeTabText, mode === "bulk" && s.modeTabTextActive]}>
                  Bulk import
                </Text>
              </Pressable>
            </View>
          </View>

          {mode === "individual" ? (
            <ScrollView
              style={s.body}
              contentContainerStyle={s.bodyContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search dances"
                placeholderTextColor={colors.muted}
                style={s.search}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />

              {searching && !results.length && (
                <ActivityIndicator color={colors.gold} style={s.loader} />
              )}
              {results.map((dance) => (
                <Pressable
                  key={dance.id}
                  style={s.resultRow}
                  onPress={() => handleAdd(dance)}
                  disabled={addingId === dance.id}
                >
                  <View style={s.resultCopy}>
                    <View style={s.resultTitleLine}>
                      <Text style={s.resultName} numberOfLines={1}>{dance.name}</Text>
                      <View style={[s.difficultyBadge, { borderColor: DIFFICULTY_COLOR[dance.difficulty] }]}>
                        <Text style={[s.difficultyBadgeText, { color: DIFFICULTY_COLOR[dance.difficulty] }]}>
                          {dance.difficulty}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.resultSub} numberOfLines={1}>{dance.defaultSong}</Text>
                  </View>
                  {addingId === dance.id && <ActivityIndicator color={colors.gold} size="small" />}
                </Pressable>
              ))}
              {trimmedQuery.length > 0 && !searching && !results.length && (
                <Text style={s.empty}>No matches for "{trimmedQuery}".</Text>
              )}
            </ScrollView>
          ) : (
            <>
              <ScrollView
                style={s.body}
                contentContainerStyle={s.bodyContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                <Text style={s.bulkHint}>
                  Paste the dances you forgot — bullet list, checklist, or
                  one name per line. Each one is matched to the most
                  relevant BootStepper result automatically.
                </Text>
                <TextInput
                  value={bulkText}
                  onChangeText={setBulkText}
                  placeholder={"Raised Like That\nRude Dude\nStetson"}
                  placeholderTextColor={colors.muted}
                  style={s.bulkInput}
                  multiline
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {bulkMissed.length > 0 && (
                  <Text style={s.bulkMissed}>No match for: {bulkMissed.join(", ")}</Text>
                )}
              </ScrollView>
              <View style={s.stickyFooter}>
                {bulkImporting && (
                  <View style={s.bulkProgressWrap}>
                    <Text style={s.bulkProgressText}>
                      Adding {bulkProgress.done} of {bulkProgress.total}…
                    </Text>
                    <ProgressBar done={bulkProgress.done} total={bulkProgress.total} />
                  </View>
                )}
                <Pressable
                  style={[s.bulkAddButton, (!bulkText.trim() || bulkImporting) && s.disabled]}
                  onPress={handleBulkAdd}
                  disabled={!bulkText.trim() || bulkImporting}
                >
                  <Text style={s.bulkAddButtonText}>
                    {bulkImporting ? "Adding…" : "Add dances"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 20 },
  card: { backgroundColor: "#2b1f35", borderRadius: 28, maxHeight: "80%", paddingTop: 25 },
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
  headerArea: { paddingHorizontal: 25 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", paddingRight: 36 },
  subtitle: { color: colors.gold, fontSize: 13, fontWeight: "700", marginTop: 4, marginBottom: 14 },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  modeTab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  modeTabActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  modeTabText: { color: colors.muted, fontSize: 12.5, fontWeight: "700" },
  modeTabTextActive: { color: "#fff" },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: 25, paddingBottom: 25 },
  bulkHint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  bulkInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 14,
    minHeight: 140,
  },
  bulkMissed: { color: "#ff8080", fontSize: 12, marginTop: 10, lineHeight: 17 },
  stickyFooter: {
    paddingHorizontal: 25,
    paddingTop: 14,
    paddingBottom: 25,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  bulkProgressWrap: { marginBottom: 12, gap: 6 },
  bulkProgressText: { color: colors.muted, fontSize: 12.5, fontWeight: "700" },
  bulkAddButton: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
  },
  bulkAddButtonText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  disabled: { opacity: 0.5 },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
    marginBottom: 10,
  },
  loader: { marginTop: 14 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  resultCopy: { flex: 1, paddingRight: 10 },
  resultTitleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultName: { color: colors.ink, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  resultSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  difficultyBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  difficultyBadgeText: { fontSize: 9, fontWeight: "800" },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
