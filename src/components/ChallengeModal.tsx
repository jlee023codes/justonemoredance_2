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
import { Friend } from "../services/friends";
import { createChallenge } from "../services/challenges";
import { Avatar } from "./Avatar";
import { DateTimeField } from "./DateTimeField";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Invite one or more friends to a dances-and-steps challenge over a
 *  date range — same bottom-sheet chrome as MakeEventModal.tsx, plus a
 *  new multi-select friend list (first of its kind in this app; the
 *  only existing "Picker" modal, VenuePicker, is single-select).
 *
 *  With 2+ friends selected, an Instagram-style choice appears:
 *  challenge each of them individually (N separate 1:1 challenges,
 *  sent one at a time so a single failure doesn't block the rest and
 *  can be reported by name) or challenge them all as one named group
 *  (a single challenge row with everyone in it). */
export function ChallengeModal({
  visible,
  friends,
  hasUsername,
  onClose,
  onCreated,
}: {
  visible: boolean;
  friends: Friend[];
  hasUsername: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"individual" | "group">("individual");
  const [groupName, setGroupName] = useState("");
  const [startsOn, setStartsOn] = useState<Date>(startOfToday);
  const [endsOn, setEndsOn] = useState<Date>(startOfToday);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setSelected(new Set());
    setMode("individual");
    setGroupName("");
    const today = startOfToday();
    setStartsOn(today);
    setEndsOn(today);
    setError("");
  }, [visible]);

  // A stale "group" choice can't survive deselecting back down to
  // ≤1 friend, since there's no fan-out decision left to make then.
  useEffect(() => {
    if (selected.size <= 1) setMode("individual");
  }, [selected.size]);

  const toggleFriend = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleStartChange = (picked: Date) => {
    setStartsOn(picked);
    // Keep the end date valid if the start date moved past it.
    if (endsOn.getTime() < picked.getTime()) setEndsOn(picked);
  };

  const handleCreate = async () => {
    if (!hasUsername) return setError("Set a username first — friends need it to find and challenge you.");
    if (!selected.size) return setError("Pick at least one friend to challenge.");
    if (endsOn.getTime() < startsOn.getTime()) {
      return setError("End date must be on or after the start date.");
    }
    if (mode === "group" && !groupName.trim()) {
      return setError("Give this group a name.");
    }
    setSaving(true);
    setError("");
    try {
      const ids = [...selected];
      if (mode === "group" && ids.length > 1) {
        await createChallenge(ids, startsOn, endsOn, groupName.trim());
      } else {
        // Sent one at a time (not Promise.all) so a single friend's
        // failure doesn't block the others, and we can report exactly
        // who didn't go through instead of one opaque batch error.
        const failed: string[] = [];
        for (const id of ids) {
          try {
            await createChallenge([id], startsOn, endsOn, null);
          } catch {
            failed.push(friends.find((f) => f.id === id)?.displayName ?? "a friend");
          }
        }
        if (failed.length) {
          throw new Error(`Couldn't challenge ${failed.join(", ")}. The others went through.`);
        }
      }
      onCreated();
      onClose();
    } catch (err) {
      showError(err, "Could not send that challenge.");
    } finally {
      setSaving(false);
    }
  };

  const multiSelected = selected.size > 1;
  const sendLabel = saving
    ? "Sending…"
    : mode === "individual" && multiSelected
      ? "⚔️ Send challenges"
      : "⚔️ Send challenge";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.sheet}>
          <Text style={s.title}>⚔️ Challenge friends</Text>
          <Text style={s.subtitle}>
            Compete on dances logged and steps taken over a date range — two
            separate leaderboards, no single winner.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" style={s.body}>
            <Text style={s.fieldLabel}>WHO</Text>
            {friends.length ? (
              friends.map((friend) => {
                const active = selected.has(friend.id);
                return (
                  <Pressable
                    key={friend.id}
                    style={s.friendRow}
                    onPress={() => toggleFriend(friend.id)}
                  >
                    <View style={s.rowAvatar}>
                      <Avatar avatarUrl={friend.avatarUrl} label={friend.displayName} size={32} />
                    </View>
                    <Text style={s.friendName} numberOfLines={1}>
                      {friend.displayName}
                    </Text>
                    <View style={[s.checkbox, active && s.checkboxOn]}>
                      {active && <Text style={s.checkmark}>✓</Text>}
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <Text style={s.hint}>Add some friends first.</Text>
            )}

            {multiSelected && (
              <>
                <Text style={s.fieldLabel}>HOW</Text>
                <View style={s.modeSegmentRow}>
                  <Pressable
                    style={[s.modeSegment, mode === "individual" && s.modeSegmentActive]}
                    onPress={() => setMode("individual")}
                  >
                    <Text style={[s.modeSegmentText, mode === "individual" && s.modeSegmentTextActive]}>
                      Challenge each individually
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[s.modeSegment, mode === "group" && s.modeSegmentActive]}
                    onPress={() => setMode("group")}
                  >
                    <Text style={[s.modeSegmentText, mode === "group" && s.modeSegmentTextActive]}>
                      Challenge as a group
                    </Text>
                  </Pressable>
                </View>
                {mode === "group" && (
                  <TextInput
                    value={groupName}
                    onChangeText={setGroupName}
                    placeholder="Group name (e.g. Studio Crew)"
                    placeholderTextColor={colors.muted}
                    style={s.groupNameInput}
                  />
                )}
              </>
            )}

            <DateTimeField
              label="STARTS"
              mode="date"
              value={startsOn}
              onChange={handleStartChange}
              minimumDate={startOfToday()}
            />
            <DateTimeField
              label="ENDS"
              mode="date"
              value={endsOn}
              onChange={setEndsOn}
              minimumDate={startsOn}
            />

            {error ? <Text style={s.error}>{error}</Text> : null}
          </ScrollView>

          <Pressable
            style={[
              s.createButton,
              (saving || !friends.length || !hasUsername || (mode === "group" && !groupName.trim())) &&
                s.disabled,
            ]}
            onPress={handleCreate}
            disabled={saving || !friends.length || !hasUsername || (mode === "group" && !groupName.trim())}
          >
            <Text style={s.createText}>{sendLabel}</Text>
          </Pressable>
          <Pressable onPress={onClose} disabled={saving}>
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 34,
    maxHeight: "86%",
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 6, marginBottom: 14, lineHeight: 18 },
  body: { flexGrow: 0 },
  fieldLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: 14,
    marginBottom: 7,
  },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowAvatar: { marginRight: 10 },
  friendName: { color: colors.ink, fontSize: 14, fontWeight: "700", flex: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  checkmark: { color: "#fff", fontSize: 14, fontWeight: "900" },
  modeSegmentRow: { flexDirection: "row", gap: 8 },
  modeSegment: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  modeSegmentActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  modeSegmentText: { color: colors.muted, fontSize: 12.5, fontWeight: "700", textAlign: "center" },
  modeSegmentTextActive: { color: "#fff" },
  groupNameInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 14,
    marginTop: 10,
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
  cancel: { color: colors.muted, textAlign: "center", fontWeight: "700", marginTop: 16 },
});
