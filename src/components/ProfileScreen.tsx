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
import { InfoTooltip } from "./InfoTooltip";
import { supabase } from "../lib/supabase";
import {
  presentCustomerCenter,
  presentPaywallIfNeeded,
  restorePurchases,
  SYNC_ENTITLEMENT_ID,
  tierAtLeast,
  Tier,
  TIER_LABELS,
} from "../lib/entitlements";
import { deleteAccount } from "../lib/account";
import { NotesImportModal } from "./NotesImportModal";
import { countPendingImport } from "../services/notesImport";
import {
  loadDancedVenues,
  loadHomeVenueId,
  loadMostDancedVenue,
  loadVenueById,
  VenueOption,
} from "../services/venues";
import {
  getMyProfile,
  loadProfileMeta,
  setDancerSince,
  setFavoriteDance,
  setFirstDance,
} from "../services/friends";
import { setAutoAddNewDances } from "../services/checkinSessions";
import { Avatar } from "./Avatar";
import { AvatarPickerModal } from "./AvatarPickerModal";
import { AWARDS as awards, VENUE_AWARDS } from "../lib/awards";
import { Dance, DanceProgress, LearningStatus } from "../types";
import {
  DEFAULT_SYNC_SCOPE,
  DEFAULT_YOUTUBE_SYNC_SCOPE,
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
  YoutubeAccountStatus,
  YoutubeStatusGroup,
  YoutubeSyncScope,
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

// Each of YouTube's two playlists (Tutorials, Demos — see
// YoutubePlaylistKind in lib/youtubeSync.ts) gets its own copy of this
// same status-scope picker, independently. "Learning" here really means
// want + learning together (see musicSync.ts's YoutubeSyncScope comment).
const YOUTUBE_SCOPE_OPTIONS: { key: YoutubeStatusGroup; label: string }[] = [
  { key: "learning", label: "Learning + Want to Learn" },
  { key: "learned", label: "Learned" },
];

function sameScope<T extends string>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((s) => bSet.has(s));
}

/** Multi-select scope toggle, reused for the music providers' four-status
 *  filter and (one instance each) YouTube's Tutorials/Demos status scope.
 *  "Everything" is never its own stored state; it's purely a derived
 *  shortcut, checked whenever every option is already selected, and
 *  tapping it either selects them all or (if already all selected)
 *  resets to `defaultValue` — deselecting any one option naturally
 *  un-derives "Everything" with no special-case code needed. Edits are
 *  local until Save, so toggling several chips doesn't fire a write per
 *  tap. */
function SyncScopePicker<T extends string>({
  label,
  value,
  options,
  defaultValue,
  onSave,
}: {
  label: string;
  value: T[];
  options: { key: T; label: string }[];
  defaultValue: T[];
  onSave: (scope: T[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<T[]>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const everythingOn = options.every((opt) => draft.includes(opt.key));
  const dirty = !sameScope(draft, value);

  const toggleOption = (key: T) => {
    setDraft((current) =>
      current.includes(key) ? current.filter((s) => s !== key) : [...current, key],
    );
  };

  const toggleEverything = () => {
    setDraft(everythingOn ? defaultValue : options.map((o) => o.key));
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
        {options.map((opt) => {
          const active = draft.includes(opt.key);
          return (
            <Pressable
              key={opt.key}
              onPress={() => toggleOption(opt.key)}
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
  openImport,
  onImportHandled,
  onOpenOfflineList,
  tier,
  musicRefreshKey,
  onMusicChanged,
  onConnected,
  autoAddNewDances,
  onAutoAddNewDancesChange,
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
  // Set true right after an offline import is queued — opens the matcher.
  openImport?: boolean;
  onImportHandled?: () => void;
  // Opens the on-device offline notepad (lives in App).
  onOpenOfflineList?: () => void;
  // Real RevenueCat entitlement OR a manual server comp — see
  // src/lib/entitlements.ts. Used here to gate the three Connect actions
  // ("sync" or above) and scope the venue picker's search ("pro" unlocks
  // browsing the whole shared catalog, not just your own).
  tier: Tier;
  // Bumped in App.tsx after Spotify's web OAuth round trip completes, so
  // this screen's connection-status reads refresh.
  musicRefreshKey: number;
  // Bumped after any connect/disconnect here, so My List's playlist-sync
  // row (which also depends on connection status) refreshes.
  onMusicChanged?: () => void;
  // Called right after a successful Spotify/Apple Music/YouTube connect —
  // switches the active tab to My List, since that's where the new
  // Create/Sync button actually shows up. Native/Apple Music resolve
  // here; web's Spotify/YouTube connect finishes in App.tsx instead (see
  // handleSpotifyAuthResult/handleGoogleAuthResult there), which calls
  // this same navigation separately.
  onConnected?: () => void;
  // Whether new-to-me dances from a tracked session get added to My
  // List automatically at session-end — see
  // src/services/checkinSessions.ts's loadAutoAddNewDances. App.tsx
  // owns the live value (DancingSessionScreen needs it too); this
  // screen just renders/toggles it.
  autoAddNewDances: boolean;
  onAutoAddNewDancesChange: (enabled: boolean) => void;
}) {
  const next = awards.find((award) => award.count > learnedCount);

  // Profile picture — a premade icon badge or an uploaded photo (see
  // src/lib/avatarPresets.ts / AvatarPickerModal). Loaded independently
  // of username/display name (which live in FriendsScreen's own editing
  // UI) since this screen is where the user actually asked for the
  // picture to live.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarLabel, setAvatarLabel] = useState("?");
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  useEffect(() => {
    getMyProfile(userId)
      .then((p) => {
        setAvatarUrl(p.avatarUrl);
        setAvatarLabel(p.displayName || p.username || "?");
      })
      .catch(() => {});
  }, [userId]);

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

  // Venues — derived from dances actually tagged (user_venue_dances),
  // not a manually curated add/remove list anymore. Setting the home
  // bar itself now happens on the Venues page (VenueCard's 🏠 toggle);
  // this just displays the result.
  const [dancedVenues, setDancedVenues] = useState<VenueOption[]>([]);
  const [homeVenueId, setHomeVenueId] = useState<string | null>(null);
  const [homeVenueName, setHomeVenueName] = useState<string | null>(null);
  const [milestonesTab, setMilestonesTab] = useState<"dances" | "venues">("dances");
  const [mostDancedVenue, setMostDancedVenue] = useState<VenueOption | null>(null);
  const refreshVenues = () => {
    Promise.all([loadDancedVenues(userId), loadHomeVenueId(userId)])
      .then(([venues, homeId]) => {
        setDancedVenues(venues);
        setHomeVenueId(homeId);
      })
      .catch(() => {});
    loadMostDancedVenue(userId).then(setMostDancedVenue).catch(() => {});
  };

  useEffect(() => {
    if (!homeVenueId) {
      setHomeVenueName(null);
      return;
    }
    loadVenueById(homeVenueId)
      .then((v) => setHomeVenueName(v?.name ?? null))
      .catch(() => {});
  }, [homeVenueId]);

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
  const [youtubeStatus, setYoutubeStatus] = useState<YoutubeAccountStatus | null>(null);
  const [syncScope, setSyncScope] = useState<PlaylistSyncScope>(["learning", "learned"]);
  const [youtubeTutorialsScope, setYoutubeTutorialsScopeState] = useState<YoutubeSyncScope>(
    DEFAULT_YOUTUBE_SYNC_SCOPE,
  );
  const [youtubeDemosScope, setYoutubeDemosScopeState] = useState<YoutubeSyncScope>(
    DEFAULT_YOUTUBE_SYNC_SCOPE,
  );
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
    loadYoutubeSyncScope(userId, "tutorials").then(setYoutubeTutorialsScopeState).catch(() => {});
    loadYoutubeSyncScope(userId, "demos").then(setYoutubeDemosScopeState).catch(() => {});
  };

  useEffect(() => {
    refreshMusicAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, musicRefreshKey]);

  const handleConnectSpotify = async () => {
    if (!tierAtLeast(tier, "sync")) return void presentPaywallIfNeeded(SYNC_ENTITLEMENT_ID);
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
      onConnected?.();
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
    if (!tierAtLeast(tier, "sync")) return void presentPaywallIfNeeded(SYNC_ENTITLEMENT_ID);
    setConnectingProvider("apple");
    try {
      const musicUserToken = await connectApple();
      if (!musicUserToken) return; // user closed the prompt — nothing to alert on
      await connectAppleMusic(musicUserToken);
      refreshMusicAccounts();
      onMusicChanged?.();
      onConnected?.();
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

  const handleToggleAutoAdd = async (enabled: boolean) => {
    onAutoAddNewDancesChange(enabled);
    try {
      await setAutoAddNewDances(userId, enabled);
    } catch (err: any) {
      onAutoAddNewDancesChange(!enabled); // roll back
      showAlert("Couldn't save that", err?.message ?? "Please try again.");
    }
  };

  const handleConnectYoutube = async () => {
    if (!tierAtLeast(tier, "sync")) return void presentPaywallIfNeeded(SYNC_ENTITLEMENT_ID);
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
      onConnected?.();
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

  const handleChangeYoutubeTutorialsScope = async (scope: YoutubeSyncScope) => {
    setYoutubeTutorialsScopeState(scope);
    try {
      await setYoutubeSyncScope(userId, "tutorials", scope);
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? "Please try again.");
    }
  };

  const handleChangeYoutubeDemosScope = async (scope: YoutubeSyncScope) => {
    setYoutubeDemosScopeState(scope);
    try {
      await setYoutubeSyncScope(userId, "demos", scope);
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
  // listener, which App.tsx is already subscribed to, so `tier`
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
      <Pressable style={s.avatarHeader} onPress={() => setAvatarPickerOpen(true)}>
        <Avatar avatarUrl={avatarUrl} label={avatarLabel} size={72} />
        <View style={s.avatarEditBadge}>
          <Text style={s.avatarEditBadgeText}>✎</Text>
        </View>
      </Pressable>

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
            {homeVenueName ?? "Tap 🏠 on a venue in Venues to set one"}
          </Text>
        </View>
        <View style={s.factSection}>
          <Text style={s.settingLabel}>MOST DANCED AT</Text>
          <Text style={s.factValue}>
            {mostDancedVenue?.name ?? "Tag a dance to a venue to find out"}
          </Text>
        </View>
      </View>

      <Text style={s.section}>MILESTONES</Text>
      <View style={s.milestonesTabs}>
        <Pressable
          style={[s.milestonesTab, milestonesTab === "dances" && s.milestonesTabOn]}
          onPress={() => setMilestonesTab("dances")}
        >
          <Text style={[s.milestonesTabText, milestonesTab === "dances" && s.milestonesTabTextOn]}>
            Dance Progress
          </Text>
        </Pressable>
        <Pressable
          style={[s.milestonesTab, milestonesTab === "venues" && s.milestonesTabOn]}
          onPress={() => setMilestonesTab("venues")}
        >
          <Text style={[s.milestonesTabText, milestonesTab === "venues" && s.milestonesTabTextOn]}>
            Venues
          </Text>
        </Pressable>
      </View>
      {milestonesTab === "dances"
        ? awards.map((award) => {
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
          })
        : VENUE_AWARDS.map((award) => {
            const unlocked = dancedVenues.length >= award.count;
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
                  {unlocked ? "UNLOCKED" : `${dancedVenues.length}/${award.count}`}
                </Text>
              </View>
            );
          })}

      <Text style={s.section}>MUSIC</Text>
      <View style={s.settings}>
        <Text style={s.hint}>
          Connect a music account to turn My List into a real playlist —
          sync it any time from My List. {tierAtLeast(tier, "sync") ? "" : "Grapevine unlocks this."}
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
          options={SCOPE_OPTIONS}
          defaultValue={DEFAULT_SYNC_SCOPE}
          onSave={handleChangeSyncScope}
        />
      </View>

      <Text style={s.section}>VIDEOS</Text>
      <View style={s.settings}>
        <Text style={s.hint}>
          Connect YouTube to turn My List's videos into two real playlists —
          Tutorials and Demos — synced any time from My List.{" "}
          {tierAtLeast(tier, "sync") ? "" : "Grapevine unlocks this."}
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
          label="TUTORIALS — SYNC…"
          value={youtubeTutorialsScope}
          options={YOUTUBE_SCOPE_OPTIONS}
          defaultValue={DEFAULT_YOUTUBE_SYNC_SCOPE}
          onSave={handleChangeYoutubeTutorialsScope}
        />

        <SyncScopePicker
          label="DEMOS — SYNC…"
          value={youtubeDemosScope}
          options={YOUTUBE_SCOPE_OPTIONS}
          defaultValue={DEFAULT_YOUTUBE_SYNC_SCOPE}
          onSave={handleChangeYoutubeDemosScope}
        />
      </View>

      <Text style={s.section}>SETTINGS</Text>
      <View style={s.settings}>
        <Text style={s.settingLabel}>DANCE TRACKING</Text>
        <View style={s.checkboxRow}>
          <Pressable
            style={s.checkboxToggle}
            onPress={() => handleToggleAutoAdd(!autoAddNewDances)}
            hitSlop={4}
          >
            <View style={[s.checkbox, autoAddNewDances && s.checkboxOn]}>
              {autoAddNewDances && <Text style={s.checkboxMark}>✓</Text>}
            </View>
            <Text style={s.checkboxLabel}>Auto-add new dances to My List</Text>
          </Pressable>
          <InfoTooltip
            text={
              autoAddNewDances
                ? "New dances from a tracked session are added automatically — review them anytime from Stats."
                : "New dances from a tracked session won't be added automatically — add them from Stats when you're ready."
            }
          />
        </View>

        <Text style={[s.settingLabel, s.syncScopeLabel]}>SIGNED IN AS</Text>
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
            {tier === "free" ? "Free" : `★ ${TIER_LABELS[tier]}`}
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
        tier={tier}
        onClose={() => {
          setImportOpen(false);
          refreshPendingImport();
        }}
      />

      <AvatarPickerModal
        visible={avatarPickerOpen}
        userId={userId}
        hasAvatar={!!avatarUrl}
        onChange={setAvatarUrl}
        onClose={() => setAvatarPickerOpen(false)}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  avatarHeader: {
    alignSelf: "center",
    marginBottom: 14,
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.gold,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEditBadgeText: { color: colors.bg, fontSize: 12, fontWeight: "900" },
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
  milestonesTabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
  milestonesTab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  milestonesTabOn: { borderColor: colors.pink, backgroundColor: "#ff4e9b22" },
  milestonesTabText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  milestonesTabTextOn: { color: colors.pink },
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
  disabled: { opacity: 0.4 },
  inputBad: { borderColor: "#ff8080" },
  error: { color: "#ff8080", fontSize: 12, marginTop: 8, lineHeight: 17 },
  settings: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
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
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 },
  checkboxToggle: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  checkboxMark: { color: "#fff", fontSize: 13, fontWeight: "900" },
  checkboxLabel: { flex: 1, color: colors.ink, fontSize: 13.5, fontWeight: "700" },
  scopeSave: {
    backgroundColor: colors.pink,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 10,
  },
  scopeSaveText: { color: "#fff", fontWeight: "800", fontSize: 13 },
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
