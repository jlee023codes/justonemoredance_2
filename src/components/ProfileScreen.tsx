import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "../styles";
import { confirmAction, showAlert } from "../lib/alerts";
import { supabase } from "../lib/supabase";
import { presentCustomerCenter, restorePurchases } from "../lib/entitlements";
import { NotesImportModal } from "./NotesImportModal";
import { VenuePicker } from "./VenuePicker";
import { countPendingImport } from "../services/notesImport";
import {
  addUserVenue,
  homeFirst,
  loadHomeVenueId,
  loadUserVenues,
  removeUserVenue,
  setHomeVenue,
  VenueOption,
} from "../services/venues";
import { Dance, DanceProgress } from "../types";

const awards = [
  { count: 1, icon: "🌟", title: "First Steps", note: "Learn 1 dance" },
  { count: 5, icon: "✨", title: "Dance Regular", note: "Learn 5 dances" },
  {
    count: 10,
    icon: "🏆",
    title: "Dance Floor Legend",
    note: "Learn 10 dances",
  },
  { count: 25, icon: "👑", title: "Headliner", note: "Learn 25 dances" },
];

export function ProfileScreen({
  userId,
  email,
  learnedCount,
  wantCount,
  progress,
  onSignOut,
  onProgressChange,
  onCacheDances,
  onVenuesChanged,
  openImport,
  onImportHandled,
  onOpenOfflineList,
  isPremium,
}: {
  userId: string;
  email?: string;
  learnedCount: number;
  wantCount: number;
  /** Passed through to the Notes-import modal so it can mark dances the
   *  user already has. */
  progress: Record<string, DanceProgress>;
  onSignOut: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  /** Lets an imported dance render with full BootStepper details at once. */
  onCacheDances: (dances: Dance[]) => void;
  // Lets My List re-read its venue filter after a venue is added/removed here.
  onVenuesChanged?: () => void;
  // Set true right after an offline import is queued — opens the matcher.
  openImport?: boolean;
  onImportHandled?: () => void;
  // Opens the on-device offline notepad (lives in App).
  onOpenOfflineList?: () => void;
  // Real RevenueCat entitlement OR a manual server comp — see
  // src/lib/entitlements.ts. Used here to scope the venue picker's search
  // (Premium unlocks browsing the whole shared catalog, not just your own).
  isPremium: boolean;
}) {
  const next = awards.find((award) => award.count > learnedCount);

  // Change password
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Apple Notes import (also where an offline notepad import lands)
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState(0);
  const refreshPendingImport = () => {
    countPendingImport(userId)
      .then(setPendingImport)
      .catch(() => setPendingImport(0));
  };

  // App flips `openImport` right after queuing an offline notepad — jump
  // straight into the matcher.
  useEffect(() => {
    if (!openImport) return;
    setImportOpen(true);
    refreshPendingImport();
    onImportHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openImport]);

  // My venues — the list of venues that show up as a filter in My List.
  const [myVenues, setMyVenues] = useState<VenueOption[]>([]);
  const [homeVenueId, setHomeVenueId] = useState<string | null>(null);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venuesError, setVenuesError] = useState("");
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const refreshVenues = () => {
    setVenuesLoading(true);
    Promise.all([loadUserVenues(userId), loadHomeVenueId(userId)])
      .then(([venues, homeId]) => {
        setMyVenues(venues);
        setHomeVenueId(homeId);
      })
      .catch((err: any) =>
        setVenuesError(err?.message ?? "Could not load your venues."),
      )
      .finally(() => setVenuesLoading(false));
  };

  useEffect(() => {
    refreshPendingImport();
    refreshVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleSetHome = async (venueId: string | null) => {
    setHomeVenueId(venueId); // optimistic
    try {
      await setHomeVenue(userId, venueId);
      onVenuesChanged?.();
    } catch (err: any) {
      setVenuesError(err?.message ?? "Could not save your home bar.");
      loadHomeVenueId(userId).then(setHomeVenueId).catch(() => {});
    }
  };

  const handleAddVenue = async (venue: VenueOption) => {
    setVenuePickerOpen(false);
    setVenuesError("");
    try {
      await addUserVenue(userId, venue.id);
      // addUserVenue also records an endorsement — reflect that locally.
      const endorsed: VenueOption = {
        ...venue,
        votes: (venue.votes ?? 0) + (venue.votedByMe ? 0 : 1),
        votedByMe: true,
      };
      setMyVenues((current) =>
        current.some((v) => v.id === venue.id)
          ? current
          : [...current, endorsed].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
      );
      onVenuesChanged?.();
    } catch (err: any) {
      setVenuesError(err?.message ?? "Could not add that venue.");
    }
  };

  const handleRemoveVenue = async (venue: VenueOption) => {
    const ok = await confirmAction(
      "Remove venue?",
      `Remove ${venue.name} from your venues? Dances you tagged there stay in your list — they just won't be filterable by ${venue.name} anymore.`,
      "Remove",
      true,
    );
    if (!ok) return;
    try {
      await removeUserVenue(userId, venue.id);
      setMyVenues((current) => current.filter((v) => v.id !== venue.id));
      // Can't be your home bar if it's not in your list anymore.
      if (homeVenueId === venue.id) await handleSetHome(null);
      onVenuesChanged?.();
    } catch (err: any) {
      setVenuesError(err?.message ?? "Could not remove that venue.");
    }
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    if (newPassword.length < 6) {
      return setPasswordError("Your password must be at least 6 characters.");
    }
    if (newPassword !== confirmNewPassword) {
      return setPasswordError("Those passwords don't match.");
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) return setPasswordError(error.message);

    setNewPassword("");
    setConfirmNewPassword("");
    setPasswordOpen(false);
    showAlert(
      "Password changed",
      "Use your new password next time you sign in.",
    );
  };

  // Restoring re-links any past purchase on this Apple/Google account to
  // this RevenueCat customer — no result handling needed beyond the
  // message: a successful restore fires RevenueCat's customer-info
  // listener, which App.tsx is already subscribed to, so `isPremium`
  // (and anything gated on it) updates on its own.
  const [restoring, setRestoring] = useState(false);
  const handleRestorePurchases = async () => {
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.success) {
        showAlert("Restored", "Your purchases have been restored.");
      } else if (result.error) {
        showAlert("Could not restore your purchases", result.error);
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.section}>Keeping Track Somewhere Else Already?</Text>
      <View style={s.friendsCard}>
        <Text style={s.hint}>
          Paste your list of line dances from your Notes app, Google sheet, etc.
          Then match each one to the real dance you want. {"\n\n"}Stop any time
          and pick up where you left off later.
        </Text>
        <Pressable
          style={s.setUsernameButton}
          onPress={() => setImportOpen(true)}
        >
          <Text style={s.setUsernameText}>
            {pendingImport > 0
              ? `Resume import — ${pendingImport} left`
              : "Import Dances"}
          </Text>
        </Pressable>
        {onOpenOfflineList ? (
          <Pressable style={s.offlineNotepadButton} onPress={onOpenOfflineList}>
            <Text style={s.offlineNotepadText}>
              ✏️ Offline notepad — jot dances with no signal
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={s.section}>Your dance journey</Text>
      <View style={s.hero}>
        <View style={s.heroStats}>
          <View style={s.heroStat}>
            <Text style={s.number}>{learnedCount}</Text>
            <Text style={s.heroTitle}>learned</Text>
          </View>
          <View style={s.heroDivider} />
          <View style={s.heroStat}>
            <Text style={s.numberPink}>{wantCount}</Text>
            <Text style={s.heroTitle}>want to learn</Text>
          </View>
        </View>
        <Text style={s.heroNote}>
          {next
            ? `${next.count - learnedCount} more to unlock ${next.title}`
            : "Every award unlocked — amazing!"}
        </Text>
      </View>

      <Text style={s.section}>AWARDS</Text>
      {awards.map((award) => {
        const unlocked = learnedCount >= award.count;
        return (
          <View
            key={award.title}
            style={[s.award, unlocked && s.awardUnlocked]}
          >
            <Text style={s.awardIcon}>{award.icon}</Text>
            <View style={s.awardCopy}>
              <Text style={[s.awardTitle, unlocked && s.unlockedText]}>
                {award.title}
              </Text>
              <Text style={s.awardNote}>{award.note}</Text>
            </View>
            <Text style={s.status}>
              {unlocked ? "UNLOCKED" : `${learnedCount}/${award.count}`}
            </Text>
          </View>
        );
      })}

      <Text style={s.section}>MY VENUES</Text>
      <View style={s.settings}>
        <Text style={s.hint}>
          Venues you add here become a filter in My List — tag a dance to a
          venue from its details, then filter your list by where you dance it.
          Tap 🏠 to set your home bar; it stays pinned to the top everywhere.
        </Text>
        {venuesError ? <Text style={s.error}>{venuesError}</Text> : null}
        {venuesLoading && !myVenues.length ? (
          <ActivityIndicator color={colors.gold} style={s.inlineLoader} />
        ) : null}
        {!venuesLoading && !myVenues.length ? (
          <Text style={[s.hint, s.venuesEmpty]}>No venues added yet.</Text>
        ) : null}
        {homeFirst(myVenues, homeVenueId).map((venue) => {
          const isHome = venue.id === homeVenueId;
          return (
            <View key={venue.id} style={s.venueRow}>
              <Pressable
                onPress={() => handleSetHome(isHome ? null : venue.id)}
                hitSlop={8}
              >
                <Text style={[s.venueHome, isHome && s.venueHomeOn]}>
                  {isHome ? "🏠" : "⌂"}
                </Text>
              </Pressable>
              <Text style={s.venueName} numberOfLines={1}>
                {venue.name}
                {isHome ? <Text style={s.venueHomeTag}>  home bar</Text> : null}
              </Text>
              <Text style={s.venueVotes}>★ {venue.votes ?? 1}</Text>
              <Pressable onPress={() => handleRemoveVenue(venue)} hitSlop={8}>
                <Text style={s.venueRemove}>✕</Text>
              </Pressable>
            </View>
          );
        })}
        <Pressable
          style={s.addVenueButton}
          onPress={() => setVenuePickerOpen(true)}
        >
          <Text style={s.addVenueText}>＋ Add a venue</Text>
        </Pressable>
      </View>

      <Text style={s.section}>SETTINGS</Text>
      <View style={s.settings}>
        <Text style={s.settingLabel}>SIGNED IN AS</Text>
        <Text style={s.email}>{email ?? "Guest dancer"}</Text>

        {/* Guests have no password to change. */}
        {email ? (
          passwordOpen ? (
            <View style={s.passwordBlock}>
              <Text style={s.settingLabel}>NEW PASSWORD</Text>
              <TextInput
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                placeholder="New password (6+ characters)"
                placeholderTextColor={colors.muted}
                value={newPassword}
                onChangeText={(text) => {
                  setNewPassword(text);
                  setPasswordError("");
                }}
                style={s.passwordInput}
                editable={!savingPassword}
                autoFocus
              />
              <TextInput
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                placeholder="Confirm new password"
                placeholderTextColor={colors.muted}
                value={confirmNewPassword}
                onChangeText={(text) => {
                  setConfirmNewPassword(text);
                  setPasswordError("");
                }}
                style={[
                  s.passwordInput,
                  !!confirmNewPassword &&
                    confirmNewPassword !== newPassword &&
                    s.inputBad,
                ]}
                editable={!savingPassword}
              />
              {passwordError ? (
                <Text style={s.error}>{passwordError}</Text>
              ) : null}
              <Pressable
                style={[s.savePassword, savingPassword && s.disabled]}
                onPress={handleChangePassword}
                disabled={savingPassword}
              >
                <Text style={s.savePasswordText}>
                  {savingPassword ? "Saving…" : "Save new password"}
                </Text>
              </Pressable>
              <Pressable
                style={s.cancelPassword}
                onPress={() => {
                  setPasswordOpen(false);
                  setNewPassword("");
                  setConfirmNewPassword("");
                  setPasswordError("");
                }}
              >
                <Text style={s.cancelPasswordText}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={s.changePassword}
              onPress={() => setPasswordOpen(true)}
            >
              <Text style={s.changePasswordText}>Change password</Text>
            </Pressable>
          )
        ) : null}

        <View style={s.subscriptionRow}>
          <Text style={s.settingLabel}>SUBSCRIPTION</Text>
          <Text style={s.subscriptionStatus}>
            {isPremium ? "★ Premium" : "Free"}
          </Text>
        </View>
        <Pressable
          style={s.changePassword}
          onPress={() => void presentCustomerCenter()}
        >
          <Text style={s.changePasswordText}>Manage subscription</Text>
        </Pressable>
        <Pressable
          style={[s.cancelPassword, restoring && s.disabled]}
          onPress={handleRestorePurchases}
          disabled={restoring}
        >
          <Text style={s.cancelPasswordText}>
            {restoring ? "Restoring…" : "Restore purchases"}
          </Text>
        </Pressable>

        <Pressable style={s.signOut} onPress={onSignOut}>
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <NotesImportModal
        visible={importOpen}
        userId={userId}
        progress={progress}
        onProgressChange={onProgressChange}
        onCacheDances={onCacheDances}
        onClose={() => {
          setImportOpen(false);
          refreshPendingImport();
        }}
      />

      <VenuePicker
        visible={venuePickerOpen}
        title="Add a venue"
        userId={userId}
        homeVenueId={homeVenueId}
        restrictToMine={!isPremium}
        alreadyAddedVenueIds={myVenues.map((v) => v.id)}
        onSelect={handleAddVenue}
        onClose={() => setVenuePickerOpen(false)}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  heading: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    marginBottom: 18,
  },
  hero: {
    backgroundColor: "#393028",
    borderWidth: 1,
    borderColor: "#6c5630",
    borderRadius: 16,
    padding: 16,
  },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroStat: { flex: 1, alignItems: "center" },
  heroDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "#6c5630",
    marginVertical: 2,
  },
  number: { color: colors.gold, fontSize: 32, fontWeight: "900" },
  numberPink: { color: colors.pink, fontSize: 32, fontWeight: "900" },
  heroTitle: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  heroNote: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#6c5630",
    textAlign: "center",
  },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 25,
    marginBottom: 8,
  },
  award: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 13,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
    opacity: 0.55,
  },
  awardUnlocked: { opacity: 1, borderWidth: 1, borderColor: "#6c5630" },
  awardIcon: { fontSize: 25, width: 42 },
  awardCopy: { flex: 1 },
  awardTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  unlockedText: { color: colors.gold },
  awardNote: { color: colors.muted, fontSize: 12, marginTop: 3 },
  status: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  friendsCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
  settingLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  setUsernameButton: {
    backgroundColor: colors.pink,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginTop: 6,
  },
  setUsernameText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  offlineNotepadButton: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginTop: 8,
  },
  offlineNotepadText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 17 },
  inlineLoader: { alignSelf: "flex-start", marginTop: 6 },
  disabled: { opacity: 0.4 },
  inputBad: { borderColor: "#ff8080" },
  error: { color: "#ff8080", fontSize: 12, marginTop: 8, lineHeight: 17 },
  settings: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
  venuesEmpty: { marginTop: 12 },
  venueRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 12,
  },
  venueHome: {
    fontSize: 15,
    color: colors.muted,
    width: 24,
    marginRight: 6,
  },
  venueHomeOn: { color: colors.gold },
  venueHomeTag: { color: colors.gold, fontSize: 11, fontWeight: "800" },
  venueName: { color: colors.ink, fontSize: 15, flex: 1, fontWeight: "700" },
  venueVotes: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    marginRight: 4,
  },
  venueRemove: { color: colors.muted, fontSize: 14, paddingHorizontal: 6 },
  addVenueButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  addVenueText: { color: colors.pink, fontWeight: "800", fontSize: 13 },
  email: { color: colors.ink, fontSize: 15, marginTop: 5 },
  changePassword: {
    marginTop: 17,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  changePasswordText: { color: colors.gold, fontWeight: "800" },
  passwordBlock: {
    marginTop: 17,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  passwordInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 12,
    fontSize: 15,
    marginTop: 8,
  },
  savePassword: {
    backgroundColor: colors.pink,
    borderRadius: 10,
    padding: 13,
    alignItems: "center",
    marginTop: 12,
  },
  savePasswordText: { color: "#fff", fontWeight: "800" },
  cancelPassword: { padding: 11, alignItems: "center" },
  cancelPasswordText: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  subscriptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 17,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  subscriptionStatus: { color: colors.gold, fontSize: 13, fontWeight: "800" },
  signOut: {
    marginTop: 17,
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  signOutText: { color: colors.pink, fontWeight: "800" },
});
