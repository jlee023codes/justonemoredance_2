import { useState } from "react";
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
import { DateTimeField } from "./DateTimeField";
import { addVenueNight, DAY_LABEL, DAY_ORDER, DayOfWeek, VenueOption } from "../services/venues";

function defaultStart() {
  const d = new Date();
  d.setHours(19, 0, 0, 0); // 7:00 PM
  return d;
}
function defaultEnd() {
  const d = new Date();
  d.setHours(23, 0, 0, 0); // 11:00 PM
  return d;
}
function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** start - end (age, $cover), dropping whichever of age/cover is blank —
 *  this is the exact string stored in venue_nights.details. */
function formatNightDetails(start: Date, end: Date, age: string, cover: string): string {
  const range = `${formatTime(start)} - ${formatTime(end)}`;
  const trimmedCover = cover.trim();
  const parts = [
    age.trim(),
    trimmedCover ? (trimmedCover.startsWith("$") ? trimmedCover : `$${trimmedCover}`) : "",
  ].filter(Boolean);
  return parts.length ? `${range} (${parts.join(", ")})` : range;
}

type DayState = { enabled: boolean; start: Date; end: Date; age: string; cover: string };

function initialDayState(): Record<DayOfWeek, DayState> {
  return Object.fromEntries(
    DAY_ORDER.map((d) => [d, { enabled: false, start: defaultStart(), end: defaultEnd(), age: "", cover: "" }]),
  ) as Record<DayOfWeek, DayState>;
}

/** Shown right after a venue is newly added to the catalog — the
 *  creator can always manage its nights (migration_venue_created_by.sql),
 *  so this seeds the weekly schedule in one pass instead of making them
 *  add each day one at a time from the card later. Entirely optional —
 *  "Skip for now" leaves it empty, same as any other venue. */
export function VenueScheduleModal({
  venue,
  onClose,
}: {
  venue: VenueOption | null;
  onClose: () => void;
}) {
  const [days, setDays] = useState<Record<DayOfWeek, DayState>>(initialDayState);
  const [saving, setSaving] = useState(false);

  if (!venue) return null;

  const updateDay = (day: DayOfWeek, patch: Partial<DayState>) => {
    setDays((cur) => ({ ...cur, [day]: { ...cur[day], ...patch } }));
  };

  const handleSave = async () => {
    const enabled = DAY_ORDER.filter((d) => days[d].enabled);
    if (!enabled.length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await Promise.all(
        enabled.map((d) => {
          const { start, end, age, cover } = days[d];
          return addVenueNight(venue.id, d, formatNightDetails(start, end, age, cover));
        }),
      );
      onClose();
    } catch (err: any) {
      showError(err, "Could not save the schedule — you can add nights later from the venue card.");
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10} disabled={saving}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>
          <Text style={s.title}>Add a schedule?</Text>
          <Text style={s.subtitle}>{venue.name}</Text>
          <Text style={s.hint}>
            Optional — fill in whichever nights this venue has line
            dancing. You can add more later from the venue card.
          </Text>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {DAY_ORDER.map((d) => {
              const state = days[d];
              return (
                <View key={d} style={s.dayBlock}>
                  <Pressable
                    style={s.dayToggle}
                    onPress={() => updateDay(d, { enabled: !state.enabled })}
                  >
                    <Text style={[s.dayToggleText, state.enabled && s.dayToggleTextOn]}>
                      {state.enabled ? "✓ " : "+ "}
                      {DAY_LABEL[d]}
                    </Text>
                  </Pressable>
                  {state.enabled && (
                    <View style={s.dayFields}>
                      <View style={s.timeRow}>
                        <View style={s.timeField}>
                          <DateTimeField
                            label="Start"
                            mode="time"
                            value={state.start}
                            onChange={(start) => updateDay(d, { start })}
                          />
                        </View>
                        <View style={s.timeField}>
                          <DateTimeField
                            label="End"
                            mode="time"
                            value={state.end}
                            onChange={(end) => updateDay(d, { end })}
                          />
                        </View>
                      </View>
                      <View style={s.textRow}>
                        <TextInput
                          value={state.age}
                          onChangeText={(age) => updateDay(d, { age })}
                          placeholder="Age (e.g. 18+)"
                          placeholderTextColor={colors.muted}
                          style={s.textInput}
                        />
                        <TextInput
                          value={state.cover}
                          onChangeText={(cover) => updateDay(d, { cover })}
                          placeholder="Cover ($)"
                          placeholderTextColor={colors.muted}
                          style={s.textInput}
                          keyboardType="numbers-and-punctuation"
                        />
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={s.actions}>
            <Pressable style={[s.saveButton, saving && s.disabled]} onPress={handleSave} disabled={saving}>
              <Text style={s.saveText}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
            <Pressable onPress={onClose} disabled={saving} hitSlop={6}>
              <Text style={s.skip}>Skip for now</Text>
            </Pressable>
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
    padding: 25,
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
  title: { color: colors.ink, fontSize: 23, fontWeight: "900", paddingRight: 36 },
  subtitle: { color: colors.gold, fontSize: 13, fontWeight: "700", marginTop: 4 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8, marginBottom: 6 },
  scroll: { marginTop: 6 },
  scrollContent: { paddingBottom: 4 },
  dayBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 10,
  },
  dayToggle: {},
  dayToggleText: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  dayToggleTextOn: { color: colors.pink },
  dayFields: { marginTop: 8, gap: 8 },
  timeRow: { flexDirection: "row", gap: 10 },
  timeField: { flex: 1 },
  textRow: { flexDirection: "row", gap: 10 },
  textInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 16 },
  saveButton: {
    flex: 1,
    backgroundColor: colors.pink,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  disabled: { opacity: 0.4 },
  skip: { color: colors.muted, fontSize: 13, fontWeight: "700" },
});
