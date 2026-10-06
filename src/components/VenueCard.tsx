import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../styles";
import { showError } from "../lib/alerts";
import { openDirections } from "../lib/directions";
import {
  addVenueNight,
  DAY_LABEL,
  DAY_ORDER,
  DayOfWeek,
  deleteVenueNight,
  setHomeVenue,
  updateVenueNight,
  VenueOption,
  VENUE_PUBLIC_THRESHOLD,
} from "../services/venues";

/** One venue in the Venues tab's card list. Nights can only be added or
 *  edited by an admin or an approved rep for this specific venue
 *  (migration_venue_reps.sql) — everyone else sees "Become this venue's
 *  rep" or "Submit a revision" instead. */
export function VenueCard({
  venue,
  userId,
  isHome,
  onOpenDances,
  onSubmitRevision,
  onRequestRep,
  onNightsChanged,
  onHomeChanged,
}: {
  venue: VenueOption;
  userId: string;
  isHome?: boolean;
  onOpenDances: () => void;
  onSubmitRevision: () => void;
  onRequestRep: () => void;
  onNightsChanged: (nights: { day: DayOfWeek; details: string }[]) => void;
  // Called with the new home-venue id (or null if unset) after a
  // successful toggle — the parent tracks homeVenueId across the whole
  // list, since setting one venue as home unsets whichever was home
  // before.
  onHomeChanged: (homeVenueId: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState<DayOfWeek | null>(null);
  const [details, setDetails] = useState("");
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [settingHome, setSettingHome] = useState(false);

  const handleToggleHome = async () => {
    if (settingHome) return;
    const nextHomeId = isHome ? null : venue.id;
    setSettingHome(true);
    try {
      await setHomeVenue(userId, nextHomeId);
      onHomeChanged(nextHomeId);
    } catch (err: any) {
      showError(err, "Could not set your home bar.");
    } finally {
      setSettingHome(false);
    }
  };

  const nights = venue.nights ?? [];
  const takenDays = new Set(nights.map((n) => n.day));
  const availableDays = DAY_ORDER.filter((d) => !takenDays.has(d));
  const canManage = Boolean(venue.canManageNights) && !venue.detailsLocked;
  const canAddNight = canManage && availableDays.length > 0;

  const handleSave = async () => {
    if (!day) return;
    setSaving(true);
    setNote("");
    try {
      const applied = await addVenueNight(venue.id, day, details);
      if (applied) {
        onNightsChanged([...nights, { day, details: details.trim() }]);
        setAdding(false);
        setDay(null);
        setDetails("");
      } else {
        setNote("That day already has details.");
      }
    } catch (err: any) {
      setNote(err?.message ?? "Could not save that night.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (d: DayOfWeek) => {
    if (!editDraft.trim()) return;
    setSaving(true);
    try {
      await updateVenueNight(venue.id, d, editDraft);
      onNightsChanged(
        nights.map((n) => (n.day === d ? { ...n, details: editDraft.trim() } : n)),
      );
      setEditingDay(null);
      setEditDraft("");
    } catch (err: any) {
      showError(err, "Could not save that change.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (d: DayOfWeek) => {
    setSaving(true);
    try {
      await deleteVenueNight(venue.id, d);
      onNightsChanged(nights.filter((n) => n.day !== d));
    } catch (err: any) {
      showError(err, "Could not remove that night.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <Text style={s.name} numberOfLines={2}>
          {venue.name}
          {(venue.publicCount ?? 0) >= VENUE_PUBLIC_THRESHOLD && (
            <Text style={s.verifiedMark}> ✓ (Verified)</Text>
          )}
        </Text>
        <Pressable
          style={s.iconBox}
          onPress={handleToggleHome}
          hitSlop={6}
          accessibilityLabel="Set as home bar"
        >
          <Text style={[s.home, isHome && s.homeOn]}>{isHome ? "🏠" : "⌂"}</Text>
        </Pressable>
        <View style={s.iconBox}>
          <Text style={s.votes}>
            {venue.votedByMe ? "★" : "☆"} {venue.votes ?? 0}
          </Text>
        </View>
      </View>

      {venue.locked && (
        <Text style={s.lockedNote}>
          🔒 Only visible to you — unlocks for everyone once{" "}
          {VENUE_PUBLIC_THRESHOLD - (venue.publicCount ?? 0)} more{" "}
          {VENUE_PUBLIC_THRESHOLD - (venue.publicCount ?? 0) === 1 ? "person checks in or logs a dance" : "people check in or log a dance"}{" "}
          here.
        </Text>
      )}

      {venue.address && <Text style={s.address}>{venue.address}</Text>}

      {(venue.latitude != null || venue.address) && (
        <Pressable
          style={s.directionsButton}
          onPress={() => openDirections(venue).catch(() => {})}
          hitSlop={6}
        >
          <Text style={s.directionsButtonText}>📍 Get Directions</Text>
        </Pressable>
      )}

      {nights.length > 0 && (
        <View style={s.nights}>
          {nights.map((n) =>
            editingDay === n.day ? (
              <View key={n.day} style={s.editBox}>
                <TextInput
                  value={editDraft}
                  onChangeText={setEditDraft}
                  placeholder="6pm-11pm, 18+, $15 cover"
                  placeholderTextColor={colors.muted}
                  style={s.editInput}
                  autoFocus
                />
                <View style={s.editActions}>
                  <Pressable onPress={() => handleSaveEdit(n.day)} disabled={saving} hitSlop={6}>
                    <Text style={s.editSave}>{saving ? "Saving…" : "Save"}</Text>
                  </Pressable>
                  <Pressable onPress={() => setEditingDay(null)} disabled={saving} hitSlop={6}>
                    <Text style={s.editCancel}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View key={n.day} style={s.nightRow}>
                <Text style={s.nightDay}>{DAY_LABEL[n.day]}</Text>
                <Text style={s.nightDetails}>{n.details}</Text>
                {canManage && (
                  <View style={s.nightActions}>
                    <Pressable
                      onPress={() => {
                        setEditingDay(n.day);
                        setEditDraft(n.details);
                      }}
                      hitSlop={6}
                    >
                      <Text style={s.nightActionText}>✏️</Text>
                    </Pressable>
                    <Pressable onPress={() => handleDelete(n.day)} hitSlop={6}>
                      <Text style={[s.nightActionText, s.nightDeleteText]}>✕</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ),
          )}
        </View>
      )}

      {canAddNight &&
        (adding ? (
          <View style={s.editBox}>
            <View style={s.dayPicker}>
              {availableDays.map((d) => (
                <Pressable
                  key={d}
                  style={[s.dayChip, day === d && s.dayChipOn]}
                  onPress={() => setDay(d)}
                >
                  <Text style={[s.dayChipText, day === d && s.dayChipTextOn]}>
                    {DAY_LABEL[d]}
                  </Text>
                </Pressable>
              ))}
            </View>
            {day && (
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="6pm-11pm, 18+, $15 cover"
                placeholderTextColor={colors.muted}
                style={s.editInput}
                autoFocus
              />
            )}
            {note ? <Text style={s.note}>{note}</Text> : null}
            <View style={s.editActions}>
              <Pressable onPress={handleSave} disabled={saving || !day || !details.trim()} hitSlop={6}>
                <Text style={s.editSave}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setAdding(false);
                  setDay(null);
                  setDetails("");
                }}
                disabled={saving}
                hitSlop={6}
              >
                <Text style={s.editCancel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} hitSlop={6}>
            <Text style={s.addNight}>+ Add a night</Text>
          </Pressable>
        ))}

      <View style={s.footerRow}>
        <Pressable style={s.whatsPlaying} onPress={onOpenDances}>
          <Text style={s.whatsPlayingText}>🎶 What's Playing</Text>
        </Pressable>
        <View style={s.footerLinks}>
          {venue.repStatus === "pending" ? (
            <Text style={s.repPending}>Rep request pending</Text>
          ) : !venue.canManageNights && venue.repStatus !== "denied" ? (
            <Pressable onPress={onRequestRep} hitSlop={6}>
              <Text style={s.revisionLink}>🤝 Rep This Venue</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onSubmitRevision} hitSlop={6}>
            <Text style={s.revisionLink}>✏️ Submit a revision</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: "900" },
  // Fixed-height box per icon so differing glyph/emoji vertical metrics
  // (🏠 vs ★13) can't throw off centering against each other — same
  // reasoning as TabIcon.tsx, just a plain box instead of SVG since
  // these are single icons, not a whole icon set.
  iconBox: { height: 24, alignItems: "center", justifyContent: "center" },
  votes: { color: colors.gold, fontSize: 13, fontWeight: "800" },
  home: { color: colors.muted, fontSize: 18 },
  verifiedMark: { color: colors.gold, fontWeight: "900" },
  homeOn: { color: colors.gold },
  address: { color: colors.muted, fontSize: 12, marginTop: 4 },
  lockedNote: { color: colors.gold, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  directionsButton: { alignSelf: "flex-start", marginTop: 10 },
  directionsButtonText: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  nights: { marginTop: 10, gap: 4 },
  nightRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nightDay: { color: colors.gold, fontSize: 12, fontWeight: "800", width: 34 },
  nightDetails: { flex: 1, color: colors.ink, fontSize: 12 },
  nightActions: { flexDirection: "row", gap: 10 },
  nightActionText: { fontSize: 12 },
  nightDeleteText: { color: colors.muted },
  addNight: { color: colors.pink, fontSize: 12, fontWeight: "700", marginTop: 12 },
  editBox: { marginTop: 10, gap: 8 },
  dayPicker: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dayChipOn: { borderColor: colors.pink, backgroundColor: "#ff4e9b22" },
  dayChipText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  dayChipTextOn: { color: colors.pink },
  editInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    color: colors.ink,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  editActions: { flexDirection: "row", gap: 16 },
  editSave: { color: colors.pink, fontSize: 13, fontWeight: "800" },
  editCancel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  note: { color: colors.gold, fontSize: 11, lineHeight: 15 },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexWrap: "wrap",
    gap: 8,
  },
  footerLinks: { gap: 6, alignItems: "flex-end" },
  whatsPlaying: {
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  whatsPlayingText: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  revisionLink: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  repPending: { color: colors.gold, fontSize: 11, fontWeight: "700" },
});
