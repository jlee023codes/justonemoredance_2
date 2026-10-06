import { useEffect, useState } from "react";
import {
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
import { VenueOption } from "../services/venues";
import { createBackfilledSession } from "../services/checkinSessions";
import { parseNotesText } from "../services/notesImport";
import { searchDances } from "../lib/bootstepper";
import { VenuePicker } from "./VenuePicker";
import { DateTimeField } from "./DateTimeField";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Backfills a whole night you forgot to check in for — venue, date,
 *  and a pasted list of dances (same parseNotesText parser as every
 *  other paste-import in this app). Inserts an already-closed-out
 *  session with no step count, shown in Stats as "N/A — not live
 *  tracked" rather than a real pedometer reading. */
export function AddPastNightModal({
  visible,
  userId,
  onClose,
  onAdded,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [venue, setVenue] = useState<VenueOption | null>(null);
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const [dancedOn, setDancedOn] = useState<Date>(startOfToday);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [noMatch, setNoMatch] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setVenue(null);
    setDancedOn(startOfToday());
    setText("");
    setError("");
    setNoMatch([]);
  }, [visible]);

  const handleSave = async () => {
    if (!venue) return setError("Pick a venue first.");
    const parsed = parseNotesText(text);
    if (!parsed.length) return setError("Add at least one dance.");
    setSaving(true);
    setError("");
    try {
      const dances: Parameters<typeof createBackfilledSession>[3] = [];
      const missed: string[] = [];
      for (const line of parsed) {
        const found = await searchDances(line.name).catch(() => []);
        const dance = found[0];
        if (!dance) {
          missed.push(line.name);
          continue;
        }
        dances.push(dance);
      }
      if (!dances.length) {
        setNoMatch(missed);
        setError("None of those matched a real dance — check the spelling and try again.");
        return;
      }
      await createBackfilledSession(userId, venue, dancedOn, dances);
      setNoMatch(missed);
      onAdded();
      if (!missed.length) onClose();
    } catch (err: any) {
      showError(err, "Could not save that night.");
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={s.overlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.sheet}>
            <Pressable style={s.closeButton} onPress={onClose} disabled={saving} hitSlop={10}>
              <Text style={s.closeButtonText}>✕</Text>
            </Pressable>
            <Text style={s.title}>Add a past night</Text>
            <Text style={s.subtitle}>
              Forgot to check in? Backfill the venue, date, and dances —
              shown in Stats without a step count.
            </Text>

            <ScrollView
              style={s.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <Text style={s.fieldLabel}>VENUE</Text>
              <Pressable style={s.select} onPress={() => setVenuePickerOpen(true)}>
                <Text style={s.selectText}>{venue ? venue.name : "Choose a venue"}</Text>
                <Text style={s.caret}>▾</Text>
              </Pressable>

              <View style={s.dateField}>
                <DateTimeField
                  label="DATE"
                  mode="date"
                  value={dancedOn}
                  onChange={setDancedOn}
                />
              </View>

              <Text style={s.fieldLabel}>DANCES</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Raised Like That&#10;Rude Dude&#10;Stetson"
                placeholderTextColor={colors.muted}
                style={s.input}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {noMatch.length > 0 && (
                <Text style={s.importMissed}>No match for: {noMatch.join(", ")}</Text>
              )}
              {error ? <Text style={s.error}>{error}</Text> : null}
            </ScrollView>

            <View style={s.stickyFooter}>
              <Pressable
                style={[s.saveButton, (saving || !venue || !text.trim()) && s.disabled]}
                onPress={handleSave}
                disabled={saving || !venue || !text.trim()}
              >
                <Text style={s.saveText}>{saving ? "Saving…" : "Save night"}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <VenuePicker
        visible={venuePickerOpen}
        title="Where were you dancing?"
        userId={userId}
        selectedVenueId={venue?.id}
        onSelect={(picked) => {
          setVenue(picked);
          setVenuePickerOpen(false);
        }}
        onClose={() => setVenuePickerOpen(false)}
      />
    </>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 24,
    maxHeight: "88%",
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
  title: { color: colors.ink, fontSize: 22, fontWeight: "900", paddingHorizontal: 24, paddingRight: 46 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 6, marginBottom: 14, lineHeight: 18, paddingHorizontal: 24 },
  body: { flexGrow: 0 },
  fieldLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 14,
    marginBottom: 7,
    marginHorizontal: 24,
  },
  select: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 24,
  },
  selectText: { color: colors.ink, fontSize: 16, flex: 1 },
  caret: { color: colors.gold, fontSize: 16 },
  dateField: { marginHorizontal: 24 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 14,
    minHeight: 120,
    marginHorizontal: 24,
  },
  importMissed: { color: "#ff8080", fontSize: 12, marginTop: 10, lineHeight: 17, marginHorizontal: 24 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 12, marginHorizontal: 24 },
  stickyFooter: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  saveButton: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  disabled: { opacity: 0.5 },
});
