import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "../styles";
import { showError } from "../lib/alerts";
import { loadOfflineText, saveOfflineText, clearOfflineList } from "../services/offlineList";
import { parseNotesText, ParsedDanceLine } from "../services/notesImport";

// A notepad the user can fill in with no signal — plain free-form text, one
// dance per line (bullets/numbering optional, same parser as pasting an
// Apple Notes checklist). Names only — matching them to real BootStepper
// dances happens later, online, through the normal import flow.
export function OfflineListModal({
  visible,
  online,
  hasRealSession = true,
  userId,
  onClose,
  onImport,
}: {
  visible: boolean;
  online: boolean;
  // False from the forced-offline screen before the user has actually
  // reconnected (userId there is just `lastUser`, a remembered id with
  // no live Supabase session behind it yet). Importing against that
  // writes real data for the right account, but App.tsx's own
  // `progress` state for that account hasn't loaded — the app can't
  // show the result correctly until a real session exists, so Import
  // stays disabled until then rather than appearing to work and
  // leaving My List looking wiped. Defaults true for the normal,
  // already-authenticated mount.
  hasRealSession?: boolean;
  userId: string;
  onClose: () => void;
  // Hand the parsed lines to the parent to push into the import queue.
  onImport: (lines: ParsedDanceLine[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    loadOfflineText(userId).then(setText);
  }, [visible, userId]);

  // Autosave as the user types — no separate "Add"/"Save" step. Debounced
  // so every keystroke doesn't hit AsyncStorage individually.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      saveOfflineText(userId, text).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [text, userId, visible]);

  const parsed = useMemo(() => parseNotesText(text), [text]);

  const runImport = async () => {
    setImporting(true);
    try {
      await onImport(parsed);
      await clearOfflineList(userId);
      setText("");
    } catch (err) {
      showError(err, "Could not start the import.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>

          <View style={s.header}>
            <Text style={s.title}>Offline dance list</Text>
            <View
              style={[
                s.statusPill,
                online && hasRealSession ? s.pillOnline : s.pillOffline,
              ]}
            >
              <Text style={s.statusPillText}>
                {online && hasRealSession
                  ? "● Back online — you can import below"
                  : online
                    ? "● Reconnecting your account…"
                    : "● Offline — saved on this device"}
              </Text>
            </View>
            <Text style={s.subtitle}>
              Jot down dance names, one per line. When you&apos;re back
              online, import the list and match each one to the real dance.
            </Text>
          </View>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={"• Watermelon Crawl\n• Tush Push\n• Copperhead Road"}
            placeholderTextColor={colors.muted}
            style={s.editor}
            multiline
            textAlignVertical="top"
            autoCorrect={false}
          />

          <View style={s.stickyFooter}>
            {online && hasRealSession ? (
              <Pressable
                style={[
                  s.importButton,
                  (!parsed.length || importing) && s.disabled,
                ]}
                onPress={runImport}
                disabled={!parsed.length || importing}
              >
                <Text style={s.importButtonText}>
                  {importing
                    ? "Starting import…"
                    : parsed.length
                      ? `Import ${parsed.length} dance${
                          parsed.length === 1 ? "" : "s"
                        } into my list`
                      : "Nothing to import yet"}
                </Text>
              </Pressable>
            ) : online ? (
              <Text style={s.offlineHint}>
                Signal's back, but your account isn't fully reconnected yet —
                give it a moment, or tap "Try reconnecting" and come back here.
              </Text>
            ) : (
              <Text style={s.offlineHint}>
                You&apos;re offline. This list is safe on your phone — reconnect
                to import it.
              </Text>
            )}
          </View>
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
  header: { padding: 25, paddingBottom: 0 },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900", paddingRight: 36 },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 10,
  },
  pillOffline: { backgroundColor: "#4a3a1e" },
  pillOnline: { backgroundColor: "#20402e" },
  statusPillText: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 10,
    marginBottom: 16,
    lineHeight: 18,
  },
  editor: {
    flex: 1,
    minHeight: 220,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 14,
    fontSize: 15,
    lineHeight: 21,
    marginHorizontal: 25,
  },
  disabled: { opacity: 0.4 },
  stickyFooter: {
    paddingHorizontal: 25,
    paddingTop: 14,
    paddingBottom: 25,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  importButton: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
  },
  importButtonText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  offlineHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
});
