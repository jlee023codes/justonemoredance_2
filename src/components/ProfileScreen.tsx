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
import {
  presentCustomerCenter,
  presentPaywall,
  restorePurchases,
} from "../lib/entitlements";
import { deleteAccount } from "../lib/account";
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
import {
  loadProfileMeta,
  setDancerSince,
  setFavoriteDance,
  setFirstDance,
} from "../services/friends";
import { AWARDS as awards } from "../lib/awards";
import { Dance, DanceProgress, LearningStatus } from "../types";
import {
  DEFAULT_SYNC_SCOPE,
  loadAppleMusicStatus,
  loadPlaylistSyncScope,
  loadSpotifyBetaEnabled,
  loadSpotifyStatus,
  loadYoutubeStatus,
  loadYoutubeSyncScope,
  MusicAccountStatus,
  PlaylistSyncScope,
  setPlaylistSyncScope,
  setYoutubeSyncScope,
} from "../services/musicSync";
import { connectSpotify } from "../lib/spotifyAuth";
import { disconnectSpotify, exchangeSpotifyCode } from "../lib/spotifySync";
import { useAppleMusicConnect } from "../lib/appleMusicAuth";
import { connectAppleMusic, disconnectAppleMusic } from "../lib/appleMusicSync";
import { connectYouTube } from "../lib/googleAuth";
import { disconnectYoutube, exchangeYoutubeCode } from "../lib/youtubeSync";

const SCOPE_OPTIONS: { key: LearningStatus; label: string }[] = [
  { key: "none", label: "Untracked" },
  { key: "want", label: "Want to Learn" },
  { key: "learning", label: "Learning" },
  { key: "learned", label: "Learned" },
];

function sameScope(a: PlaylistSyncScope, b: PlaylistSyncScope): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((s) => bSet.has(s));
}

/** Multi-select replacement for the old three-way All/Learning+Learned/
 *  Learned picker — any combination of the four My List statuses is
 *  valid. "Everything" isn't its own stored state; it's purely a derived
 *  shortcut, checked whenever all four are already selected, and tapping
 *  it either selects all four or (if already all selected) resets to the
 *  app default — deselecting any one of the four naturally un-derives
 *  "Everything" with no special-case code needed. Edits are local until
 *  Save, so toggling several chips doesn't fire a write per tap. */
function SyncScopePicker({
  label,
  value,
  onSave,
}: {
  label: string;
  value: PlaylistSyncScope;
  onSave: (scope: PlaylistSyncScope) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PlaylistSyncScope>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const everythingOn = SCOPE_OPTIONS.every((opt) => draft.includes(opt.key));
  const dirty = !sameScope(draft, value);

  const toggleStatus = (status: LearningStatus) => {
    setDraft((current) =>
      current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status],
    );
  };

  const toggleEverything = () => {
    setDraft(everythingOn ? DEFAULT_SYNC_SCOPE : SCOPE_OPTIONS.map((o) => o.key));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={[s.settingLabel, s.syncScopeLabel]}>{label}</Text>
      <View style={s.syncScopeRow}>
        <Pressable
          onPress={toggleEverything}
          style={[s.scopeChip, everythingOn && s.scopeChipOn]}
        >
          <Text style={[s.scopeChipText, everythingOn && s.scopeChipTextOn]}>
            Everything
          </Text>
        </Pressable>
        {SCOPE_OPTIONS.map((opt) => {
          const active = draft.includes(opt.key);
          return (
            <Pressable
              key={opt.key}
              onPress={() => toggleStatus(opt.key)}
              style={[s.scopeChip, active && s.scopeChipOn]}
            >
              <Text style={[s.scopeChipText, active && s.scopeChipTextOn]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {dirty && (
        <Pressable
          style={[s.scopeSave, saving && s.disabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={s.scopeSaveText}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      )}
    </>
  );
}

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
  musicRefreshKey,
  onMusicChanged,
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
  // Bumped in App.tsx after Spotify's web OAuth round trip completes, so
  // this screen's connection-status reads refresh.
  musicRefreshKey: number;
  // Bumped after any connect/disconnect here, so My List's playlist-sync
  // row (which also depends on connection status) refreshes.
  onMusicChanged?: () => void;
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
  const [venuesExpanded, setVenuesExpanded] = useState(false);
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

  // Music accounts — Spotify (beta, allowlisted per-user) and Apple Music
  // (open to everyone). See src/services/musicSync.ts.
  const [spotifyBetaEnabled, setSpotifyBetaEnabled] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState<MusicAccountStatus | null>(null);
  const [appleMusicStatus, setAppleMusicStatus] = useState<MusicAccountStatus | null>(null);
  const [youtubeStatus, setYoutubeStatus] = useState<MusicAccountStatus | null>(null);
  const [syncScope, setSyncScope] = useState<PlaylistSyncScope>(["learning", "learned"]);
  const [youtubeSyncScope, setYoutubeSyncScopeState] = useState<PlaylistSyncScope>([
    "learning",
    "learned",
  ]);
  const [connectingProvider, setConnectingProvider] = useState<
    "spotify" | "apple" | "youtube" | null
  >(null);
  const { connect: connectApple } = useAppleMusicConnect();

  const refreshMusicAccounts = () => {
    loadSpotifyBetaEnabled(userId).then(setSpotifyBetaEnabled).catch(() => {});
    loadSpotifyStatus(userId).then(setSpotifyStatus).catch(() => {});
    loadAppleMusicStatus(userId).then(setAppleMusicStatus).catch(() => {});
    loadYoutubeStatus(userId).then(setYoutubeStatus).catch(() => {});
    loadPlaylistSyncScope(userId).then(setSyncScope).catch(() => {});
    loadYoutubeSyncScope(userId).then(setYoutubeSyncScopeState).catch(() => {});
  };

  useEffect(() => {
    refreshMusicAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, musicRefreshKey]);

  const handleConnectSpotify = async () => {
    if (!isPremium) return void presentPaywall();
    setConnectingProvider("spotify");
    try {
      // Web navigates away and never resolves this promise — the round
      // trip back is picked up by App.tsx's own effect instead. Native
      // resolves directly, here.
      const result = await connectSpotify();
      if (result.kind === "cancelled") return;
      if (result.kind === "error") {
        showAlert("Spotify connection failed", result.message);
        return;
      }
      await exchangeSpotifyCode(result.code, result.codeVerifier, result.redirectUri);
      refreshMusicAccounts();
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Spotify connection failed", err?.message ?? "Please try again.");
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnectSpotify = async () => {
    const ok = await confirmAction(
      "Disconnect Spotify?",
      "Just One More Dance will stop syncing to your Spotify playlist. The playlist itself stays on Spotify, untouched.",
    );
    if (!ok) return;
    try {
      await disconnectSpotify();
      refreshMusicAccounts();
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Couldn't disconnect", err?.message ?? "Please try again.");
    }
  };

  const handleConnectAppleMusic = async () => {
    if (!isPremium) return void presentPaywall();
    setConnectingProvider("apple");
    try {
      const musicUserToken = await connectApple();
      if (!musicUserToken) return; // user closed the prompt — nothing to alert on
      await connectAppleMusic(musicUserToken);
      refreshMusicAccounts();
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Apple Music connection failed", err?.message ?? "Please try again.");
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnectAppleMusic = async () => {
    const ok = await confirmAction(
      "Disconnect Apple Music?",
      "Just One More Dance will stop syncing to your Apple Music playlist. The playlist itself stays in your library, untouched.",
    );
    if (!ok) return;
    try {
      await disconnectAppleMusic();
      refreshMusicAccounts();
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Couldn't disconnect", err?.message ?? "Please try again.");
    }
  };

  const handleChangeSyncScope = async (scope: PlaylistSyncScope) => {
    setSyncScope(scope);
    try {
      await setPlaylistSyncScope(userId, scope);
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? "Please try again.");
    }
  };

  const handleConnectYoutube = async () => {
    if (!isPremium) return void presentPaywall();
    setConnectingProvider("youtube");
    try {
      // Web navigates away and never resolves this promise — the round
      // trip back is picked up by App.tsx's own effect instead. Native
      // resolves directly, here. Same shape as Spotify's connect flow.
      const result = await connectYouTube();
      if (result.kind === "cancelled") return;
      if (result.kind === "error") {
        showAlert("YouTube connection failed", result.message);
        return;
      }
      await exchangeYoutubeCode(result.code, result.codeVerifier, result.redirectUri, result.platform);
      refreshMusicAccounts();
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("YouTube connection failed", err?.message ?? "Please try again.");
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnectYoutube = async () => {
    const ok = await confirmAction(
      "Disconnect YouTube?",
      "Just One More Dance will stop syncing to your YouTube playlist. The playlist itself stays on YouTube, untouched.",
    );
    if (!ok) return;
    try {
      await disconnectYoutube();
      refreshMusicAccounts();
      onMusicChanged?.();
    } catch (err: any) {
      showAlert("Couldn't disconnect", err?.message ?? "Please try again.");
    }
  };

  const handleChangeYoutubeSyncScope = async (scope: PlaylistSyncScope) => {
    setYoutubeSyncScopeState(scope);
    try {
      await setYoutubeSyncScope(userId, scope);
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? "Please try again.");
    }
  };

  // "Fun facts" — favorite dance right now, line dancer since, first dance
  // learned. All free text, self-reported (see
  // migration_profile_fun_facts.sql) — first dance is deliberately *not*
  // derived from `progress`: an imported or out-of-order list makes
  // "oldest row currently marked learned" a bad guess, and this is the
  // kind of thing people actually remember themselves. Home bar reuses the
  // venue state just above, no fetch needed.
  type FactKey = "favorite" | "since" | "first";
  const [facts, setFacts] = useState<Record<FactKey, string | null>>({
    favorite: null,
    since: null,
    first: null,
  });
  const [editingFact, setEditingFact] = useState<FactKey | null>(null);
  const [factDraft, setFactDraft] = useState("");
  const [savingFact, setSavingFact] = useState(false);

  useEffect(() => {
    loadProfileMeta(userId)
      .then((meta) => {
        setFacts({
          favorite: meta.favoriteDance,
          since: meta.dancerSince,
          first: meta.firstDance,
        });
      })
      .catch(() => {});
  }, [userId]);

  const factSetters: Record<FactKey, (userId: string, value: string) => Promise<void>> = {
    favorite: setFavoriteDance,
    since: setDancerSince,
    first: setFirstDance,
  };

  const startEditingFact = (which: FactKey) => {
    setEditingFact(which);
    setFactDraft(facts[which] ?? "");
  };

  const saveFact = async () => {
    if (!editingFact) return;
    setSavingFact(true);
    try {
      await factSetters[editingFact](userId, factDraft);
      setFacts((cur) => ({ ...cur, [editingFact]: factDraft.trim() || null }));
      setEditingFact(null);
    } catch (err: any) {
      showAlert("Could not save that", err?.message ?? "Please try again.");
    } finally {
      setSavingFact(false);
    }
  };

  const homeBarName = myVenues.find((v) => v.id === homeVenueId)?.name ?? null;

  const renderFact = (
    which: FactKey,
    label: string,
    value: string | null,
    placeholder: string,
    spaced?: boolean,
  ) => (
    <View style={spaced ? s.factSection : undefined}>
      <Text style={s.settingLabel}>{label}</Text>
      {editingFact === which ? (
        <View style={s.factEditRow}>
          <TextInput
            value={factDraft}
            onChangeText={setFactDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            style={s.factInput}
            autoFocus
            editable={!savingFact}
            onSubmitEditing={saveFact}
          />
          <Pressable onPress={saveFact} disabled={savingFact} hitSlop={6}>
            <Text style={s.factSave}>{savingFact ? "…" : "Save"}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={s.factRow} onPress={() => startEditingFact(which)}>
          <Text style={s.factValue}>{value || placeholder}</Text>
          <Text style={s.factEdit}>✎</Text>
        </Pressable>
      )}
    </View>
  );

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

  // Apple/Google review requirement: account creation must come with an
  // in-app way to delete it, not just sign out. See
  // supabase/functions/delete-account/index.ts for what actually runs —
  // deleting auth.users cascades to every table tied to this user.
  const [deletingAccount, setDeletingAccount] = useState(false);
  const handleDeleteAccount = async () => {
    const ok = await confirmAction(
      "Delete your account?",
      "This permanently deletes your account and everything tied to it — your dance list, venues, friends, and events. This can't be undone.",
      "Delete account",
      true,
    );
    if (!ok) return;
    setDeletingAccount(true);
    try {
      await deleteAccount();
      onSignOut();
    } catch (err: any) {
      showAlert(
        "Could not delete your account",
        err?.message ?? "Please try again.",
      );
    } finally {
      setDeletingAccount(false);
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

      <Text style={s.section}>FUN FACTS</Text>
      <View style={s.settings}>
        {renderFact(
          "favorite",
          "FAVORITE DANCE RIGHT NOW",
          facts.favorite,
          "e.g. Tush Push",
        )}
        {renderFact(
          "since",
          "LINE DANCER SINCE",
          facts.since,
          "e.g. 2019",
          true,
        )}
        {renderFact(
          "first",
          "FIRST DANCE LEARNED",
          facts.first,
          "e.g. Electric Slide",
          true,
        )}
        <View style={s.factSection}>
          <Text style={s.settingLabel}>HOME BAR</Text>
          <Text style={s.factValue}>
            {homeBarName ?? "Set one in My Venues below"}
          </Text>
        </View>
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
        {(() => {
          const ordered = homeFirst(myVenues, homeVenueId);
          const visible = venuesExpanded ? ordered : ordered.slice(0, 1);
          const hiddenCount = ordered.length - visible.length;
          return (
            <>
              {visible.map((venue) => {
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
              {ordered.length > 1 ? (
                <Pressable
                  onPress={() => setVenuesExpanded((v) => !v)}
                  hitSlop={8}
                  style={s.venuesToggle}
                >
                  <Text style={s.venuesToggleText}>
                    {venuesExpanded
                      ? "Show less ▴"
                      : `Show ${hiddenCount} more venue${hiddenCount === 1 ? "" : "s"} ▾`}
                  </Text>
                </Pressable>
              ) : null}
            </>
          );
        })()}
        <Pressable
          style={s.addVenueButton}
          onPress={() => setVenuePickerOpen(true)}
        >
          <Text style={s.addVenueText}>＋ Add a venue</Text>
        </Pressable>
      </View>

      <Text style={s.section}>MUSIC</Text>
      <View style={s.settings}>
        <Text style={s.hint}>
          Connect a music account to turn My List into a real playlist —
          sync it any time from My List. {isPremium ? "" : "Premium unlocks this."}
        </Text>

        <View style={s.musicRow}>
          <View style={s.musicRowCopy}>
            <Text style={s.musicRowName}>🎧 Apple Music</Text>
            <Text style={s.musicRowStatus}>
              {appleMusicStatus?.connected ? "Connected" : "Not connected"}
            </Text>
          </View>
          {appleMusicStatus?.connected ? (
            <Pressable onPress={handleDisconnectAppleMusic} hitSlop={8}>
              <Text style={s.musicDisconnect}>Disconnect</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[s.musicConnect, connectingProvider === "apple" && s.disabled]}
              onPress={handleConnectAppleMusic}
              disabled={connectingProvider === "apple"}
            >
              {connectingProvider === "apple" ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={s.musicConnectText}>Connect</Text>
              )}
            </Pressable>
          )}
        </View>

        {spotifyBetaEnabled ? (
          <View style={s.musicRow}>
            <View style={s.musicRowCopy}>
              <Text style={s.musicRowName}>🎧 Spotify</Text>
              <Text style={s.musicRowStatus}>
                {spotifyStatus?.connected ? "Connected" : "Not connected"}
                {" · "}
                <Text style={s.musicBeta}>beta</Text>
              </Text>
            </View>
            {spotifyStatus?.connected ? (
              <Pressable onPress={handleDisconnectSpotify} hitSlop={8}>
                <Text style={s.musicDisconnect}>Disconnect</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[s.musicConnect, connectingProvider === "spotify" && s.disabled]}
                onPress={handleConnectSpotify}
                disabled={connectingProvider === "spotify"}
              >
                {connectingProvider === "spotify" ? (
                  <ActivityIndicator color={colors.bg} size="small" />
                ) : (
                  <Text style={s.musicConnectText}>Connect</Text>
                )}
              </Pressable>
            )}
          </View>
        ) : null}

        <SyncScopePicker
          label="SYNC MY LIST'S…"
          value={syncScope}
          onSave={handleChangeSyncScope}
        />
      </View>

      <Text style={s.section}>VIDEOS</Text>
      <View style={s.settings}>
        <Text style={s.hint}>
          Connect YouTube to turn My List's reference videos into a real playlist —
          sync it any time from My List. {isPremium ? "" : "Premium unlocks this."}
        </Text>

        <View style={s.musicRow}>
          <View style={s.musicRowCopy}>
            <Text style={s.musicRowName}>🎥 YouTube</Text>
            <Text style={s.musicRowStatus}>
              {youtubeStatus?.connected ? "Connected" : "Not connected"}
            </Text>
          </View>
          {youtubeStatus?.connected ? (
            <Pressable onPress={handleDisconnectYoutube} hitSlop={8}>
              <Text style={s.musicDisconnect}>Disconnect</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[s.musicConnect, connectingProvider === "youtube" && s.disabled]}
              onPress={handleConnectYoutube}
              disabled={connectingProvider === "youtube"}
            >
              {connectingProvider === "youtube" ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={s.musicConnectText}>Connect</Text>
              )}
            </Pressable>
          )}
        </View>

        <SyncScopePicker
          label="SYNC REFERENCE VIDEOS FOR…"
          value={youtubeSyncScope}
          onSave={handleChangeYoutubeSyncScope}
        />
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
        <Pressable
          style={[s.deleteAccount, deletingAccount && s.disabled]}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
        >
          <Text style={s.deleteAccountText}>
            {deletingAccount ? "Deleting…" : "Delete account"}
          </Text>
        </Pressable>
      </View>

      <NotesImportModal
        visible={importOpen}
        userId={userId}
        progress={progress}
        onProgressChange={onProgressChange}
        onCacheDances={onCacheDances}
        isPremium={isPremium}
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
  venuesToggle: { paddingVertical: 10 },
  venuesToggleText: { color: colors.pink, fontSize: 13, fontWeight: "800" },
  musicRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 12,
  },
  musicRowCopy: { flex: 1 },
  musicRowName: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  musicRowStatus: { color: colors.muted, fontSize: 12, marginTop: 2 },
  musicBeta: { color: colors.gold, fontWeight: "800" },
  musicConnect: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minWidth: 84,
    alignItems: "center",
  },
  musicConnectText: { color: colors.bg, fontWeight: "800", fontSize: 13 },
  musicDisconnect: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  syncScopeLabel: { marginTop: 16 },
  syncScopeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  scopeChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  scopeChipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  scopeChipText: { color: colors.muted, fontSize: 12.5, fontWeight: "700" },
  scopeChipTextOn: { color: colors.bg },
  scopeSave: {
    backgroundColor: colors.pink,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 10,
  },
  scopeSaveText: { color: "#fff", fontWeight: "800", fontSize: 13 },
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
  factSection: {
    marginTop: 17,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 5,
  },
  factValue: { color: colors.ink, fontSize: 15, marginTop: 5, flex: 1 },
  factEdit: { color: colors.pink, fontSize: 13, fontWeight: "800", marginLeft: 8 },
  factEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  factInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    color: colors.ink,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  factSave: { color: colors.pink, fontWeight: "800", fontSize: 13 },
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
  deleteAccount: { marginTop: 14, alignItems: "center" },
  deleteAccountText: { color: "#ff8080", fontSize: 12, fontWeight: "700" },
});
