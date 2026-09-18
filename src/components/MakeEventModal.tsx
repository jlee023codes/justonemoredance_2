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
import { createEvent } from "../services/events";
import { VenueOption } from "../services/venues";
import { VenuePicker } from "./VenuePicker";
import { DateTimeField } from "./DateTimeField";

// Defaults an event to the next half-hour, at least an hour out.
function defaultWhen(): Date {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
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
  const [when, setWhen] = useState<Date>(defaultWhen);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setVenue(null);
    setWhen(defaultWhen());
    setNote("");
    setError("");
  }, [visible]);

  const handleDateChange = (picked: Date) => {
    setWhen((prev) => {
      const next = new Date(prev);
      next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      return next;
    });
  };

  const handleTimeChange = (picked: Date) => {
    setWhen((prev) => {
      const next = new Date(prev);
      next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!venue) return setError("Pick a venue first.");
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
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
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

            <DateTimeField
              label="DATE"
              mode="date"
              value={when}
              onChange={handleDateChange}
              minimumDate={startOfToday()}
            />

            <DateTimeField
              label="TIME"
              mode="time"
              value={when}
              onChange={handleTimeChange}
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
      </KeyboardAvoidingView>

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
