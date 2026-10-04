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
import { addManualDanceToSession, SessionHistoryEntry } from "../services/checkinSessions";

/** A forgotten dance, added to an already-ended session from Stats —
 *  "＋ Add a dance" on a past session card. Keyboard-safe shell per the
 *  established pattern (KeyboardAvoidingView, scrollable body,
 *  TextInput-driven search, sticky footer N/A here since selecting a
 *  result both logs and closes — no separate submit step needed). */
export function AddDanceToSessionModal({
  entry,
  onClose,
  onAdded,
}: {
  entry: SessionHistoryEntry | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Dance[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (entry) {
      setQuery("");
      setResults([]);
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

          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={s.title}>Add a forgotten dance</Text>
            <Text style={s.subtitle} numberOfLines={1}>{entry.venueName}</Text>

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
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: 25, paddingBottom: 25 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", paddingRight: 36 },
  subtitle: { color: colors.gold, fontSize: 13, fontWeight: "700", marginTop: 4, marginBottom: 16 },
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
