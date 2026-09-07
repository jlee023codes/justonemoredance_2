import { useEffect, useMemo, useRef, useState } from "react";
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
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { confirmAction, showError } from "../lib/alerts";
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

const EXAMPLE = `My line dances
Line dances
- [x] TATLO - youtube.com
- [x] Stetson
- [x] Raised Like That (The Other Side)
- [x] Footloose`;

type Phase = "loading" | "paste" | "match" | "done";

export function NotesImportModal({
  visible,
  userId,
  progress,
  onClose,
  onProgressChange,
  onCacheDances,
}: {
  visible: boolean;
  userId: string;
  /** The user's current dances, to catch "you already have this one". */
  progress: Record<string, DanceProgress>;
  onClose: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  /** Lets a matched BootStepper dance render with full details right away. */
  onCacheDances: (dances: Dance[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pasteText, setPasteText] = useState("");
  const [queueing, setQueueing] = useState(false);

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
    setPhase("loading");
    setPasteText("");
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

    const next: DanceProgress = {
      danceId: dance.id,
      status,
      danceName: dance.name,
      danceSong: dance.defaultSong,
      danceDifficulty: dance.difficulty,
      link: item.rawLink,
    };
    // Update the app + advance now; persist in the background.
    onCacheDances([dance]);
    onProgressChange(dance.id, next);
    goNext();
    busy.current = false;

    try {
      await saveProgress(userId, next, dance);
      if (item.rawLink) {
        await setDanceLink(userId, dance.id, item.rawLink).catch(() => {});
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
      <View style={s.overlay}>
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
            <ScrollView
              contentContainerStyle={s.sheet}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.title}>Import from Apple Notes</Text>
              <Text style={s.subtitle}>
                In the Notes app, open your list, select all the text and copy
                it. Paste it below — a checklist works best.
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

              <Pressable
                style={[s.primary, !parsed.length && s.disabled]}
                onPress={handleQueue}
                disabled={!parsed.length || queueing}
              >
                <Text style={s.primaryText}>
                  {queueing
                    ? "Starting…"
                    : parsed.length
                      ? `Match ${parsed.length} dance${parsed.length === 1 ? "" : "s"}`
                      : "Paste your list above"}
                </Text>
              </Pressable>
            </ScrollView>
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
  sheet: { padding: 25, paddingBottom: 32 },
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
