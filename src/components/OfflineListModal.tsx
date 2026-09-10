import { useEffect, useState } from "react";
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
import { colors } from "../styles";
import { showError } from "../lib/alerts";
import {
  addOfflineDance,
  loadOfflineList,
  OfflineDance,
  removeOfflineDance,
  updateOfflineDance,
} from "../services/offlineList";

// A notepad the user can fill in with no signal. Names only — matching them
// to real BootStepper dances happens later, online, through the normal
// import flow.
export function OfflineListModal({
  visible,
  online,
  userId,
  onClose,
  onImport,
}: {
  visible: boolean;
  online: boolean;
  userId: string;
  onClose: () => void;
  // Hand the whole list to the parent to push into the import queue.
  onImport: (items: OfflineDance[]) => Promise<void>;
}) {
  const [items, setItems] = useState<OfflineDance[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setInput("");
    setEditingId(null);
    loadOfflineList(userId)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [visible, userId]);

  const commit = async () => {
    const name = input.trim();
    if (!name) return;
    try {
      const next = editingId
        ? await updateOfflineDance(userId, editingId, { name })
        : await addOfflineDance(userId, name);
      setItems(next);
      setInput("");
      setEditingId(null);
    } catch (err) {
      showError(err, "Could not save that on this device.");
    }
  };

  const startEdit = (item: OfflineDance) => {
    setEditingId(item.id);
    setInput(item.name);
  };

  const remove = async (id: string) => {
    try {
      const next = await removeOfflineDance(userId, id);
      setItems(next);
      if (editingId === id) {
        setEditingId(null);
        setInput("");
      }
    } catch (err) {
      showError(err, "Could not remove that.");
    }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      await onImport(items);
    } catch (err) {
      showError(err, "Could not start the import.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>

          <ScrollView
            contentContainerStyle={s.sheet}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.title}>Offline dance list</Text>
            <View style={[s.statusPill, online ? s.pillOnline : s.pillOffline]}>
              <Text style={s.statusPillText}>
                {online
                  ? "● Back online — you can import below"
                  : "● Offline — saved on this device"}
              </Text>
            </View>
            <Text style={s.subtitle}>
              Jot down dance names now. When you&apos;re back online, import the
              list and match each one to the real dance.
            </Text>

            {loading ? (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            ) : items.length === 0 ? (
              <Text style={s.empty}>
                Nothing here yet — add a dance name below.
              </Text>
            ) : (
              <View style={s.list}>
                {items.map((item, i) => (
                  <View
                    key={item.id}
                    style={[s.row, editingId === item.id && s.rowEditing]}
                  >
                    <Text style={s.num}>{i + 1}.</Text>
                    <Pressable style={s.rowMain} onPress={() => startEdit(item)}>
                      <Text style={s.name}>{item.name}</Text>
                      {item.note ? (
                        <Text style={s.note}>{item.note}</Text>
                      ) : null}
                    </Pressable>
                    <Pressable onPress={() => remove(item.id)} hitSlop={8}>
                      <Text style={s.rowDelete}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <View style={s.addRow}>
              <Text style={s.addNum}>
                {editingId ? "✎" : `${items.length + 1}.`}
              </Text>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="e.g. Watermelon Crawl"
                placeholderTextColor={colors.muted}
                style={s.input}
                onSubmitEditing={commit}
                returnKeyType="done"
                blurOnSubmit={false}
              />
              <Pressable
                style={[s.addButton, !input.trim() && s.disabled]}
                onPress={commit}
                disabled={!input.trim()}
              >
                <Text style={s.addButtonText}>
                  {editingId ? "Save" : "Add"}
                </Text>
              </Pressable>
            </View>
            {editingId ? (
              <Pressable
                onPress={() => {
                  setEditingId(null);
                  setInput("");
                }}
              >
                <Text style={s.cancelEdit}>Cancel edit</Text>
              </Pressable>
            ) : null}

            {online ? (
              <Pressable
                style={[
                  s.importButton,
                  (!items.length || importing || !!editingId) && s.disabled,
                ]}
                onPress={runImport}
                disabled={!items.length || importing || !!editingId}
              >
                <Text style={s.importButtonText}>
                  {importing
                    ? "Starting import…"
                    : items.length
                      ? `Import ${items.length} dance${
                          items.length === 1 ? "" : "s"
                        } into my list`
                      : "Nothing to import yet"}
                </Text>
              </Pressable>
            ) : (
              <Text style={s.offlineHint}>
                You&apos;re offline. This list is safe on your phone — reconnect
                to import it.
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
  loader: { marginVertical: 24 },
  empty: { color: colors.muted, fontSize: 14, marginVertical: 12 },
  list: { marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowEditing: { backgroundColor: "#392746", borderRadius: 8 },
  num: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "800",
    width: 26,
    textAlign: "right",
    marginRight: 10,
  },
  rowMain: { flex: 1 },
  name: { color: colors.ink, fontSize: 15 },
  note: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowDelete: { color: colors.muted, fontSize: 14, paddingHorizontal: 8 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
  },
  addNum: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    width: 26,
    textAlign: "right",
    marginRight: 10,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 12,
    fontSize: 15,
  },
  addButton: {
    backgroundColor: colors.pink,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginLeft: 8,
  },
  addButtonText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  disabled: { opacity: 0.4 },
  cancelEdit: {
    color: colors.muted,
    fontWeight: "700",
    fontSize: 12,
    marginTop: 8,
  },
  importButton: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 22,
  },
  importButtonText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  offlineHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 22,
  },
});
