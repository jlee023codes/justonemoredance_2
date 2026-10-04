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
import { notifyVenueRepRequest, submitVenueRevision } from "../lib/venueRevision";
import { requestVenueRep, VenueOption } from "../services/venues";

const MAX_LENGTH = 1000;

/** Two kinds of venue notification, same chrome:
 *   - "revision": free-text "something's wrong" note — emails the
 *     owner, since venue_nights writes are locked to admins/approved
 *     reps (migration_venue_reps.sql).
 *   - "rep_request": inserts a pending venue_representatives row for
 *     this venue, then emails the owner to review it.
 *  See supabase/functions/venue-revision/index.ts.
 *
 *  Keyboard-safe: a fixed close button (reachable regardless of scroll
 *  or keyboard), a scrollable body for the (multiline, growing)
 *  TextInput, and a sticky footer for the actual Send/Cancel actions
 *  outside that scroll area — same shape as NotesImportModal's
 *  stickyFooter, since this previously had neither KeyboardAvoidingView
 *  nor a reachable close button and the keyboard could cover the only
 *  way out on a real device. */
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
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.card}>
          <Pressable style={s.closeButton} onPress={onClose} hitSlop={10}>
            <Text style={s.closeButtonText}>✕</Text>
          </Pressable>

          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={s.title}>
              {isRevision ? "Submit a revision" : "Rep This Venue"}
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
              </>
            )}
          </ScrollView>

          {!already && !sent && (
            <View style={s.stickyFooter}>
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
          )}
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
    maxHeight: "80%",
    paddingTop: 25,
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
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: 25, paddingBottom: 10 },
  title: { color: colors.ink, fontSize: 23, fontWeight: "900", paddingRight: 36 },
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
  stickyFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 25,
    paddingTop: 14,
    paddingBottom: 25,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
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
