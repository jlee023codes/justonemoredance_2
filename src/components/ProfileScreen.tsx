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
  Friend,
  FriendRequest,
  cancelFriendRequest,
  getMyProfile,
  loadFriendRequests,
  loadFriends,
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  setDisplayName,
  setUsername,
} from "../services/friends";
import { FriendDancesModal } from "./FriendDancesModal";
import { NotesImportModal } from "./NotesImportModal";
import { VenuePicker } from "./VenuePicker";
import { countPendingImport } from "../services/notesImport";
import {
  addUserVenue,
  loadUserVenues,
  removeUserVenue,
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
  onPendingRequestCountChange,
  onVenuesChanged,
}: {
  userId: string;
  email?: string;
  learnedCount: number;
  wantCount: number;
  /** Passed through to the friend + Notes-import modals so they can mark
   *  dances the user already has. */
  progress: Record<string, DanceProgress>;
  onSignOut: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  /** Lets an imported dance render with full BootStepper details at once. */
  onCacheDances: (dances: Dance[]) => void;
  // Keeps the badge on the Profile tab in step with what's on screen.
  onPendingRequestCountChange?: (count: number) => void;
  // Lets My List re-read its venue filter after a venue is added/removed here.
  onVenuesChanged?: () => void;
}) {
  const next = awards.find((award) => award.count > learnedCount);

  // My username / display name
  const [username, setLocalUsername] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [displayName, setLocalDisplayName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Send a friend request
  const [usernameSearch, setUsernameSearch] = useState("");
  const [addingFriend, setAddingFriend] = useState(false);
  const [addError, setAddError] = useState("");
  const [addNotice, setAddNotice] = useState("");

  // Friends list
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsError, setFriendsError] = useState("");
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  // Pending friend requests, both directions
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);

  // Change password
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Apple Notes import
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState(0);
  const refreshPendingImport = () => {
    countPendingImport(userId)
      .then(setPendingImport)
      .catch(() => setPendingImport(0));
  };

  // My venues — the list of venues that show up as a filter in My List.
  const [myVenues, setMyVenues] = useState<VenueOption[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venuesError, setVenuesError] = useState("");
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const refreshVenues = () => {
    setVenuesLoading(true);
    loadUserVenues(userId)
      .then(setMyVenues)
      .catch((err: any) =>
        setVenuesError(err?.message ?? "Could not load your venues."),
      )
      .finally(() => setVenuesLoading(false));
  };

  const handleAddVenue = async (venue: VenueOption) => {
    setVenuePickerOpen(false);
    setVenuesError("");
    try {
      await addUserVenue(userId, venue.id);
      setMyVenues((current) =>
        current.some((v) => v.id === venue.id)
          ? current
          : [...current, venue].sort((a, b) => a.name.localeCompare(b.name)),
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
      onVenuesChanged?.();
    } catch (err: any) {
      setVenuesError(err?.message ?? "Could not remove that venue.");
    }
  };

  const publishRequests = (next: FriendRequest[]) => {
    setRequests(next);
    onPendingRequestCountChange?.(
      next.filter((r) => r.direction === "incoming").length,
    );
  };

  const refreshFriends = () => {
    setFriendsLoading(true);
    setFriendsError("");
    Promise.all([loadFriends(userId), loadFriendRequests()])
      .then(([nextFriends, nextRequests]) => {
        setFriends(nextFriends);
        publishRequests(nextRequests);
      })
      .catch((err: any) =>
        setFriendsError(err.message ?? "Could not load friends."),
      )
      .finally(() => setFriendsLoading(false));
  };

  useEffect(() => {
    getMyProfile(userId)
      .then(({ username, displayName }) => {
        setLocalUsername(username);
        setLocalDisplayName(displayName);
      })
      .catch((err: any) => {
        setUsernameError(
          err.message ??
            "Could not load your profile — has migration_friend_requests.sql been run?",
        );
      })
      .finally(() => setProfileLoaded(true));
    refreshFriends();
    refreshPendingImport();
    refreshVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleSaveUsername = async () => {
    setSavingUsername(true);
    setUsernameError("");
    try {
      const saved = await setUsername(userId, usernameInput);
      setLocalUsername(saved);
      setEditingUsername(false);
    } catch (err: any) {
      setUsernameError(err.message ?? "Could not save that username.");
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSaveName = async () => {
    setSavingName(true);
    try {
      await setDisplayName(userId, nameInput);
      setLocalDisplayName(nameInput.trim() || null);
      setEditingName(false);
    } catch (err: any) {
      showAlert("Could not save", err.message ?? "Could not save your name.");
    } finally {
      setSavingName(false);
    }
  };

  const addToFriendList = (friend: Friend) =>
    setFriends((current) =>
      current.some((f) => f.id === friend.id)
        ? current
        : [...current, friend].sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          ),
    );

  /** Opens a *request* — nobody sees anybody's list until it's accepted.
   *  The one exception is when they'd already asked you, in which case the
   *  server accepts theirs and you're friends straight away. */
  const handleSendRequest = async () => {
    if (!usernameSearch.trim()) return;
    setAddingFriend(true);
    setAddError("");
    setAddNotice("");
    try {
      const result = await sendFriendRequest(usernameSearch);
      if (result.status === "accepted") {
        addToFriendList(result.friend);
        publishRequests(requests.filter((r) => r.from.id !== result.friend.id));
        setAddNotice(
          `${result.friend.displayName} had already asked you — you're friends now.`,
        );
      } else {
        publishRequests([
          {
            requestId: result.requestId,
            direction: "outgoing",
            from: result.friend,
            createdAt: new Date().toISOString(),
          },
          ...requests,
        ]);
        setAddNotice(
          `Request sent to ${result.friend.displayName}. You'll see each other's lists once they accept.`,
        );
      }
      setUsernameSearch("");
    } catch (err: any) {
      setAddError(err.message ?? "Could not send that friend request.");
    } finally {
      setAddingFriend(false);
    }
  };

  const handleRespond = async (request: FriendRequest, accept: boolean) => {
    setAnswering(request.requestId);
    try {
      const friend = await respondToFriendRequest(request.requestId, accept);
      publishRequests(
        requests.filter((r) => r.requestId !== request.requestId),
      );
      if (accept) addToFriendList(friend);
    } catch (err: any) {
      showAlert(
        "Could not answer that request",
        err.message ?? "Try again in a moment.",
      );
      refreshFriends();
    } finally {
      setAnswering(null);
    }
  };

  const handleCancelRequest = async (request: FriendRequest) => {
    setAnswering(request.requestId);
    try {
      await cancelFriendRequest(request.requestId);
      publishRequests(
        requests.filter((r) => r.requestId !== request.requestId),
      );
    } catch (err: any) {
      showAlert(
        "Could not cancel that request",
        err.message ?? "Try again in a moment.",
      );
    } finally {
      setAnswering(null);
    }
  };

  const handleRemoveFriend = async (friend: Friend) => {
    const confirmed = await confirmAction(
      "Remove friend?",
      `Remove ${friend.displayName} as a friend? You'll stop seeing each other's lists.`,
      "Remove",
      true,
    );
    if (!confirmed) return;
    try {
      await removeFriend(friend.id);
      setFriends((current) => current.filter((f) => f.id !== friend.id));
    } catch (err: any) {
      showAlert(
        "Could not remove",
        err.message ?? "Could not remove that friend.",
      );
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

  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");

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
      </View>

      {email ? (
        <View>
          <Text style={s.section}>FRIENDS</Text>
          <View style={s.friendsCard}>
            <Text style={s.settingLabel}>MY USERNAME</Text>
            {editingUsername ? (
              <View style={s.usernameEditRow}>
                <Text style={s.atSign}>@</Text>
                <TextInput
                  value={usernameInput}
                  onChangeText={(text) => {
                    setUsernameInput(text.replace(/\s/g, ""));
                    setUsernameError("");
                  }}
                  placeholder="yourname"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={s.usernameInput}
                  autoFocus
                />
                <Pressable
                  style={s.nameSaveButton}
                  onPress={handleSaveUsername}
                  disabled={savingUsername || !usernameInput.trim()}
                >
                  <Text style={s.nameSaveText}>
                    {savingUsername ? "…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            ) : username ? (
              <Pressable
                onPress={() => {
                  setUsernameInput(username);
                  setUsernameError("");
                  setEditingUsername(true);
                }}
              >
                <Text style={s.myUsername} selectable>
                  @{username}
                </Text>
                <Text style={s.hint}>
                  Tap to change it. Long-press to copy.
                </Text>
              </Pressable>
            ) : profileLoaded ? (
              <Pressable
                style={s.setUsernameButton}
                onPress={() => {
                  setUsernameInput("");
                  setUsernameError("");
                  setEditingUsername(true);
                }}
              >
                <Text style={s.setUsernameText}>
                  Set a username so friends can add you
                </Text>
              </Pressable>
            ) : (
              <Text style={s.myUsername}> </Text>
            )}
            {usernameError ? (
              <Text style={s.error}>{usernameError}</Text>
            ) : null}

            {editingName ? (
              <View style={s.nameEditRow}>
                <TextInput
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="Your name for friends"
                  placeholderTextColor={colors.muted}
                  style={s.nameInput}
                  autoFocus
                />
                <Pressable
                  style={s.nameSaveButton}
                  onPress={handleSaveName}
                  disabled={savingName}
                >
                  <Text style={s.nameSaveText}>
                    {savingName ? "…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={s.nameRow}
                onPress={() => {
                  setNameInput(displayName ?? "");
                  setEditingName(true);
                }}
              >
                <Text style={s.nameRowText}>
                  Shown to friends as:{" "}
                  {displayName || "(unset — tap to add a name)"}
                </Text>
                <Text style={s.editLink}>Edit</Text>
              </Pressable>
            )}

            <Text style={[s.settingLabel, s.addFriendLabel]}>
              SEND A FRIEND REQUEST
            </Text>
            <View style={s.addFriendRow}>
              <Text style={s.atSignInline}>@</Text>
              <TextInput
                value={usernameSearch}
                onChangeText={(text) => {
                  setUsernameSearch(text.replace(/\s/g, ""));
                  setAddError("");
                  setAddNotice("");
                }}
                placeholder="theirname"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={s.addFriendInput}
              />
              <Pressable
                style={[
                  s.addFriendButton,
                  !usernameSearch.trim() && s.disabled,
                ]}
                onPress={handleSendRequest}
                disabled={!usernameSearch.trim() || addingFriend}
              >
                <Text style={s.addFriendButtonText}>
                  {addingFriend ? "…" : "Send"}
                </Text>
              </Pressable>
            </View>
            {addError ? <Text style={s.error}>{addError}</Text> : null}
            {addNotice ? <Text style={s.notice}>{addNotice}</Text> : null}

            {friendsLoading && (
              <ActivityIndicator color={colors.gold} style={s.inlineLoader} />
            )}
            {friendsError ? <Text style={s.error}>{friendsError}</Text> : null}

            {!friendsLoading && incoming.length > 0 && (
              <>
                <Text style={[s.settingLabel, s.addFriendLabel]}>
                  FRIEND REQUESTS ({incoming.length})
                </Text>
                {incoming.map((request) => (
                  <View key={request.requestId} style={s.requestRow}>
                    <Text style={s.friendName} numberOfLines={1}>
                      {request.from.displayName}
                      <Text style={s.requestHandle}>
                        {"  @" + request.from.username}
                      </Text>
                    </Text>
                    <Pressable
                      style={[
                        s.acceptButton,
                        answering === request.requestId && s.disabled,
                      ]}
                      onPress={() => handleRespond(request, true)}
                      disabled={answering === request.requestId}
                    >
                      <Text style={s.acceptText}>Accept</Text>
                    </Pressable>
                    <Pressable
                      style={s.declineButton}
                      onPress={() => handleRespond(request, false)}
                      disabled={answering === request.requestId}
                      hitSlop={6}
                    >
                      <Text style={s.declineText}>Decline</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}

            {!friendsLoading && outgoing.length > 0 && (
              <>
                <Text style={[s.settingLabel, s.addFriendLabel]}>
                  WAITING ON THEM
                </Text>
                {outgoing.map((request) => (
                  <View key={request.requestId} style={s.requestRow}>
                    <Text style={s.pendingName} numberOfLines={1}>
                      @{request.from.username} · pending
                    </Text>
                    <Pressable
                      style={s.declineButton}
                      onPress={() => handleCancelRequest(request)}
                      disabled={answering === request.requestId}
                      hitSlop={6}
                    >
                      <Text style={s.declineText}>Cancel</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}

            {!friendsLoading && friends.length > 0 && (
              <Text style={[s.settingLabel, s.addFriendLabel]}>
                MY FRIENDS ({friends.length})
              </Text>
            )}
            {!friendsLoading &&
              friends.length === 0 &&
              !friendsError &&
              incoming.length === 0 && (
                <Text style={s.hint}>
                  No friends yet — share your username above, or send someone a
                  request. You'll see each other's lists once they accept.
                </Text>
              )}

            {!friendsLoading &&
              friends.map((friend) => (
                <Pressable
                  key={friend.id}
                  style={s.friendRow}
                  onPress={() => setSelectedFriend(friend)}
                >
                  <Text style={s.friendName}>{friend.displayName}</Text>
                  <Text style={s.friendOpen}>View list ›</Text>
                  <Pressable
                    onPress={() => handleRemoveFriend(friend)}
                    hitSlop={8}
                  >
                    <Text style={s.friendRemove}>✕</Text>
                  </Pressable>
                </Pressable>
              ))}
          </View>
        </View>
      ) : (
        <View>
          <Text style={s.section}>FRIENDS</Text>
          <View style={s.statRow}>
            <Text style={s.statLabel}>
              You're signed in as a guest! Create an account to Add Friends.
            </Text>
          </View>
        </View>
      )}
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
        </Text>
        {venuesError ? <Text style={s.error}>{venuesError}</Text> : null}
        {venuesLoading && !myVenues.length ? (
          <ActivityIndicator color={colors.gold} style={s.inlineLoader} />
        ) : null}
        {!venuesLoading && !myVenues.length ? (
          <Text style={[s.hint, s.venuesEmpty]}>No venues added yet.</Text>
        ) : null}
        {myVenues.map((venue) => (
          <View key={venue.id} style={s.venueRow}>
            <Text style={s.venueName} numberOfLines={1}>
              {venue.name}
            </Text>
            <Pressable onPress={() => handleRemoveVenue(venue)} hitSlop={8}>
              <Text style={s.venueRemove}>✕</Text>
            </Pressable>
          </View>
        ))}
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

        <Pressable style={s.signOut} onPress={onSignOut}>
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <FriendDancesModal
        userId={userId}
        friend={selectedFriend}
        progress={progress}
        onClose={() => setSelectedFriend(null)}
        onProgressChange={onProgressChange}
      />

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
  statRow: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 15,
    flexDirection: "row",
  },
  statLabel: { color: colors.ink, fontSize: 16, flex: 1 },
  friendsCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
  settingLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  myUsername: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
  },
  setUsernameButton: {
    backgroundColor: colors.pink,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginTop: 6,
  },
  setUsernameText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  usernameEditRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  atSign: { color: colors.gold, fontSize: 16, fontWeight: "900" },
  atSignInline: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    marginRight: 4,
  },
  usernameInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 10,
    fontSize: 14,
    marginLeft: 4,
  },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 17 },
  inlineLoader: { alignSelf: "flex-start", marginTop: 6 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  nameRowText: { color: colors.ink, fontSize: 13, flex: 1 },
  editLink: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  nameEditRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  nameInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 10,
    fontSize: 14,
  },
  nameSaveButton: {
    backgroundColor: colors.pink,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginLeft: 8,
  },
  nameSaveText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  addFriendLabel: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  addFriendRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  addFriendInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.ink,
    padding: 12,
    fontSize: 15,
    letterSpacing: 1,
  },
  addFriendButton: {
    backgroundColor: colors.pink,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginLeft: 8,
  },
  addFriendButtonText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  disabled: { opacity: 0.4 },
  inputBad: { borderColor: "#ff8080" },
  error: { color: "#ff8080", fontSize: 12, marginTop: 8, lineHeight: 17 },
  notice: { color: colors.green, fontSize: 12, marginTop: 8, lineHeight: 17 },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 6,
  },
  friendName: { color: colors.ink, fontSize: 15, flex: 1, fontWeight: "700" },
  friendOpen: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  friendRemove: {
    color: colors.muted,
    fontSize: 14,
    paddingHorizontal: 6,
    marginLeft: 6,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 6,
  },
  requestHandle: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  pendingName: {
    color: colors.muted,
    fontSize: 14,
    flex: 1,
    fontWeight: "700",
  },
  acceptButton: {
    backgroundColor: colors.pink,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  acceptText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  declineButton: { paddingHorizontal: 10, paddingVertical: 8 },
  declineText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
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
  venueName: { color: colors.ink, fontSize: 15, flex: 1, fontWeight: "700" },
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
