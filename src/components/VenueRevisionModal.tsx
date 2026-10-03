import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../styles";
import { showError } from "../lib/alerts";
import { notifyVenueRepRequest, submitVenueRevision } from "../lib/venueRevision";
import { requestVenueRep, VenueOption } from "../services/venues";

const MAX_LENGTH = 1000;

/** Two kinds of venue notification, same chrome:
 *   - "revision": free-text "something's wrong" note — emails the
 *     owner, since venue_nights writes are locked to admins/approved
 *     reps (migration_venue_reps.sql).
 *   - "rep_request": inserts a pending venue_representatives row for
 *     this venue, then emails the owner to review it.
 *  See supabase/functions/venue-revision/index.ts. */
export function VenueRevisionModal({
  venue,
  userId,
  kind,
  onClose,
  onRequested,
}: {
  venue: VenueOption | null;
  userId: string;
  kind: "revision" | "rep_request";
  onClose: () => void;
  onRequested?: () => void;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [already, setAlready] = useState(false);

  if (!venue) return null;

  const isRevision = kind === "revision";

  const handleSend = async () => {
    const trimmed = note.trim();
    if (isRevision && !trimmed) return;
    setSending(true);
    try {
      if (isRevision) {
        await submitVenueRevision(venue.id, venue.name, trimmed);
      } else {
        const applied = await requestVenueRep(venue.id, userId);
        if (!applied) {
          setAlready(true);
          return;
        }
        onRequested?.();
        await notifyVenueRepRequest(venue.id, venue.name, trimmed).catch(() => {});
      }
      setSent(true);
      setTimeout(onClose, 1400);
    } catch (err: any) {
      showError(err, "Could not send that — try again in a moment.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>
            {isRevision ? "Submit a revision" : "Become this venue's rep"}
          </Text>
          <Text style={s.subtitle}>{venue.name}</Text>

          {already ? (
            <Text style={s.sent}>You've already requested this venue.</Text>
          ) : sent ? (
            <Text style={s.sent}>
              {isRevision ? "Thanks — sent!" : "Request sent — we'll review it soon."}
            </Text>
          ) : (
            <>
              {!isRevision && (
                <Text style={s.hint}>
                  Once approved, you'll be able to add and edit this venue's
                  nights directly.
                </Text>
              )}
              <TextInput
                value={note}
                onChangeText={(t) => setNote(t.slice(0, MAX_LENGTH))}
                placeholder={
                  isRevision
                    ? "What should we fix about this venue? (e.g. the cover is actually $15, they moved nights to Tuesdays)"
                    : "Optional — how are you connected to this venue?"
                }
                placeholderTextColor={colors.muted}
                style={s.input}
                multiline
                autoFocus
              />
              <View style={s.actions}>
                <Pressable
                  style={[s.sendButton, (isRevision && !note.trim()) || sending ? s.disabled : null]}
                  onPress={handleSend}
                  disabled={(isRevision && !note.trim()) || sending}
                >
                  <Text style={s.sendText}>
                    {sending ? "Sending…" : isRevision ? "Send" : "Request"}
                  </Text>
                </Pressable>
                <Pressable onPress={onClose} disabled={sending} hitSlop={6}>
                  <Text style={s.cancel}>Cancel</Text>
                </Pressable>
              </View>
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
    padding: 20,
  },
  card: {
    backgroundColor: "#2b1f35",
    borderRadius: 28,
    padding: 25,
  },
  title: { color: colors.ink, fontSize: 23, fontWeight: "900" },
  subtitle: { color: colors.gold, fontSize: 13, fontWeight: "700", marginTop: 4, marginBottom: 18 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 14,
    fontSize: 15,
    minHeight: 110,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 16 },
  sendButton: {
    flex: 1,
    backgroundColor: colors.pink,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  sendText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  disabled: { opacity: 0.4 },
  cancel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  sent: { color: colors.gold, fontSize: 16, fontWeight: "800", paddingVertical: 20 },
});
