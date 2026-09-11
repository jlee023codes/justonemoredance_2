import { useEffect, useState } from "react";
import {
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
import { createEvent } from "../services/events";
import { VenueOption } from "../services/venues";
import { VenuePicker } from "./VenuePicker";

// Plain date/time text fields rather than a native date-picker library —
// works identically on web and native with no extra dependency or rebuild.
// A real picker component would be a nice follow-up.
function parseWhen(dateText: string, timeText: string): Date | null {
  const dateMatch = dateText.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeText.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;
  const [, y, mo, d] = dateMatch;
  const [, h, mi] = timeMatch;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function MakeEventModal({
  visible,
  userId,
  homeVenueId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  userId: string;
  homeVenueId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [venue, setVenue] = useState<VenueOption | null>(null);
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const [dateText, setDateText] = useState("");
  const [timeText, setTimeText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setVenue(null);
    setDateText("");
    setTimeText("");
    setNote("");
    setError("");
  }, [visible]);

  const handleCreate = async () => {
    if (!venue) return setError("Pick a venue first.");
    const when = parseWhen(dateText, timeText);
    if (!when) return setError("Use YYYY-MM-DD for the date and HH:MM for the time.");
    if (when.getTime() < Date.now() - 60 * 1000) {
      return setError("Pick a time that hasn't already passed.");
    }
    setSaving(true);
    setError("");
    try {
      await createEvent(userId, venue, when, note);
      onCreated();
      onClose();
    } catch (err) {
      showError(err, "Could not create that event.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Text style={s.title}>Make an event</Text>
          <Text style={s.subtitle}>
            Every friend of yours will see it in their Friends tab and can
            RSVP.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" style={s.body}>
            <Text style={s.fieldLabel}>VENUE</Text>
            <Pressable style={s.select} onPress={() => setVenuePickerOpen(true)}>
              <Text style={s.selectText}>
                {venue ? venue.name : "Choose a venue"}
              </Text>
              <Text style={s.caret}>▾</Text>
            </Pressable>

            <Text style={s.fieldLabel}>DATE</Text>
            <TextInput
              value={dateText}
              onChangeText={setDateText}
              placeholder="2026-09-20"
              placeholderTextColor={colors.muted}
              keyboardType="numbers-and-punctuation"
              style={s.input}
            />

            <Text style={s.fieldLabel}>TIME</Text>
            <TextInput
              value={timeText}
              onChangeText={setTimeText}
              placeholder="19:30 (24h)"
              placeholderTextColor={colors.muted}
              keyboardType="numbers-and-punctuation"
              style={s.input}
            />

            <Text style={s.fieldLabel}>
              NOTE <Text style={s.optional}>(optional)</Text>
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Meet by the bar!"
              placeholderTextColor={colors.muted}
              style={s.input}
            />

            {error ? <Text style={s.error}>{error}</Text> : null}
          </ScrollView>

          <Pressable
            style={[s.createButton, saving && s.disabled]}
            onPress={handleCreate}
            disabled={saving}
          >
            <Text style={s.createText}>
              {saving ? "Creating…" : "🎉 Create event"}
            </Text>
          </Pressable>
          <Pressable onPress={onClose} disabled={saving}>
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>

      <VenuePicker
        visible={venuePickerOpen}
        title="Where's the event?"
        userId={userId}
        homeVenueId={homeVenueId}
        selectedVenueId={venue?.id}
        onSelect={(picked) => {
          setVenue(picked);
          setVenuePickerOpen(false);
        }}
        onClose={() => setVenuePickerOpen(false)}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 34,
    maxHeight: "86%",
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 6, marginBottom: 14 },
  body: { flexGrow: 0 },
  fieldLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 14,
    marginBottom: 7,
  },
  optional: { color: colors.muted, fontWeight: "500" },
  select: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  selectText: { color: colors.ink, fontSize: 16, flex: 1 },
  caret: { color: colors.gold, fontSize: 16 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 16,
  },
  error: { color: "#ff8080", fontSize: 13, marginTop: 12 },
  createButton: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 18,
  },
  disabled: { opacity: 0.5 },
  createText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  cancel: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 16,
  },
});
