import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { ActiveSession } from "../lib/checkinSession";
import { DateTimeField } from "./DateTimeField";

function mergeDateAndTime(date: Date, time: Date): Date {
  const merged = new Date(date);
  merged.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return merged;
}

/** Prompts when a restored check-in's venue has gone quiet a while
 *  (4+ hours since the last dance logged there, by anyone — see
 *  App.tsx's staleness check) instead of silently leaving it open
 *  forever or auto-ending on the user's behalf. Ending a session is
 *  otherwise only a manual "Done Dancing" tap (no GPS-based auto-end —
 *  that was removed as too unreliable, prone to false-triggering on
 *  bad/imprecise location fixes) — someone who just closes the app
 *  after a night out would stay "checked in" indefinitely with
 *  nothing to ever prompt them. "Still here" simply dismisses (no
 *  change, same as if this never fired); "I actually left" opens a
 *  date/time picker so the user can backdate ended_at to roughly when
 *  they really left, rather than always using right now. */
export function StaleSessionModal({
  session,
  onStillHere,
  onEnd,
}: {
  session: ActiveSession | null;
  onStillHere: () => void;
  onEnd: (endedAt: Date) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    if (!session) return;
    setPicking(false);
    setDate(new Date());
    setTime(new Date());
  }, [session?.checkinId]);

  if (!session) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onStillHere}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>Still at {session.venueName}?</Text>
          {!picking ? (
            <>
              <Text style={s.body}>
                Nothing's been logged at this venue in a while — just
                checking this is still right.
              </Text>
              <Pressable style={s.primary} onPress={onStillHere}>
                <Text style={s.primaryText}>Yes, still here</Text>
              </Pressable>
              <Pressable style={s.secondary} onPress={() => setPicking(true)}>
                <Text style={s.secondaryText}>No, I left — end it</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.body}>When did you actually leave?</Text>
              <View style={s.fieldRow}>
                <View style={s.field}>
                  <DateTimeField
                    label="DATE"
                    mode="date"
                    value={date}
                    onChange={setDate}
                    minimumDate={new Date(session.startedAt)}
                  />
                </View>
                <View style={s.field}>
                  <DateTimeField label="TIME" mode="time" value={time} onChange={setTime} />
                </View>
              </View>
              <Pressable
                style={s.primary}
                onPress={() => onEnd(mergeDateAndTime(date, time))}
              >
                <Text style={s.primaryText}>End session then</Text>
              </Pressable>
              <Pressable style={s.secondary} onPress={() => setPicking(false)}>
                <Text style={s.secondaryText}>Back</Text>
              </Pressable>
            </>
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
    padding: 24,
  },
  card: {
    backgroundColor: "#2b1f35",
    borderRadius: 20,
    padding: 22,
  },
  title: { color: colors.ink, fontSize: 18, fontWeight: "900", marginBottom: 10 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 18 },
  fieldRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  // minWidth: 0 alongside flex: 1 — without it, RN Web's flex items
  // default to min-width: auto, so a wide native date/time <input>
  // inside (see DateTimeField's own matching fix) can force this
  // column wider than its fair share of fieldRow instead of actually
  // sharing space evenly with its sibling.
  field: { flex: 1, minWidth: 0 },
  primary: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  secondary: { alignItems: "center", paddingVertical: 14 },
  secondaryText: { color: colors.muted, fontWeight: "700", fontSize: 13 },
});
