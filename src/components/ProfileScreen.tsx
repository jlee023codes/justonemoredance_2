import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "../styles";
import {
  Friend,
  addFriendByUsername,
  getMyProfile,
  loadFriends,
  removeFriend,
  setDisplayName,
  setUsername,
} from "../services/friends";
import { FriendDancesModal } from "./FriendDancesModal";
import { DanceProgress } from "src/types";

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
  onSignOut,
  onProgressChange,
}: {
  userId: string;
  email?: string;
  learnedCount: number;
  wantCount: number;
  onSignOut: () => void;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
}) {
  const next = awards.find((award) => award.count > learnedCount);

  // My username / display name
  const [username, setLocalUsername] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [displayName, setLocalDisplayName] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Add a friend
  const [usernameSearch, setUsernameSearch] = useState("");
  const [addingFriend, setAddingFriend] = useState(false);
  const [addError, setAddError] = useState("");

  // Friends list
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsError, setFriendsError] = useState("");
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  const refreshFriends = () => {
    setFriendsLoading(true);
    setFriendsError("");
    loadFriends(userId)
      .then(setFriends)
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
            "Could not load your profile — has migration_username.sql been run?",
        );
      });
    refreshFriends();
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
      const message = err.message ?? "Could not save your name.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Could not save", message);
    } finally {
      setSavingName(false);
    }
  };

  const handleAddFriend = async () => {
    if (!usernameSearch.trim()) return;
    setAddingFriend(true);
    setAddError("");
    try {
      const friend = await addFriendByUsername(usernameSearch);
      setFriends((current) =>
        [...current, friend].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        ),
      );
      setUsernameSearch("");
    } catch (err: any) {
      setAddError(err.message ?? "Could not add that friend.");
    } finally {
      setAddingFriend(false);
    }
  };

  const handleRemoveFriend = (friend: Friend) => {
    const message = `Remove ${friend.displayName} as a friend? You'll stop seeing each other's lists.`;
    const doRemove = async () => {
      try {
        await removeFriend(friend.id);
        setFriends((current) => current.filter((f) => f.id !== friend.id));
      } catch (err: any) {
        const msg = err.message ?? "Could not remove that friend.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Could not remove", msg);
      }
    };
    if (Platform.OS === "web") {
      if (window.confirm(message)) void doRemove();
    } else {
      Alert.alert("Remove friend?", message, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: doRemove },
      ]);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.heading}>Your dance journey</Text>
      <View style={s.hero}>
        <Text style={s.number}>{learnedCount}</Text>
        <View>
          <Text style={s.heroTitle}>dances learned</Text>
          <Text style={s.heroNote}>
            {next
              ? `${next.count - learnedCount} more to unlock ${next.title}`
              : "Every award unlocked — amazing!"}
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

      <Text style={s.section}>PROGRESS</Text>
      <View style={s.statRow}>
        <Text style={s.statLabel}>Want to learn</Text>
        <Text style={s.statValue}>{wantCount}</Text>
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
            ) : (
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
              ADD BY USERNAME
            </Text>
            <View style={s.addFriendRow}>
              <Text style={s.atSignInline}>@</Text>
              <TextInput
                value={usernameSearch}
                onChangeText={(text) => {
                  setUsernameSearch(text.replace(/\s/g, ""));
                  setAddError("");
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
                onPress={handleAddFriend}
                disabled={!usernameSearch.trim() || addingFriend}
              >
                <Text style={s.addFriendButtonText}>
                  {addingFriend ? "…" : "Add"}
                </Text>
              </Pressable>
            </View>
            {addError ? <Text style={s.error}>{addError}</Text> : null}

            {friendsLoading && (
              <ActivityIndicator color={colors.gold} style={s.inlineLoader} />
            )}
            {friendsError ? <Text style={s.error}>{friendsError}</Text> : null}

            {!friendsLoading && friends.length === 0 && !friendsError && (
              <Text style={s.hint}>
                No friends yet — share your code above, or add someone else's.
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

      <Text style={s.section}>SETTINGS</Text>
      <View style={s.settings}>
        <Text style={s.settingLabel}>SIGNED IN AS</Text>
        <Text style={s.email}>{email ?? "Guest dancer"}</Text>
        <Pressable style={s.signOut} onPress={onSignOut}>
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <FriendDancesModal
        userId={userId}
        friend={selectedFriend}
        onClose={() => setSelectedFriend(null)}
        onProgressChange={onProgressChange}
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
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  number: {
    color: colors.gold,
    fontSize: 44,
    fontWeight: "900",
    marginRight: 14,
  },
  heroTitle: { color: colors.ink, fontWeight: "800", fontSize: 17 },
  heroNote: { color: colors.muted, fontSize: 12, marginTop: 4 },
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
  statValue: { color: colors.pink, fontSize: 18, fontWeight: "900" },
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
  hint: { color: colors.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
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
  error: { color: "#ff8080", fontSize: 12, marginTop: 8 },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 6,
  },
  friendName: { color: colors.ink, fontSize: 15, flex: 1, fontWeight: "700" },
  friendRemove: { color: colors.muted, fontSize: 14, paddingHorizontal: 6 },
  settings: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
  email: { color: colors.ink, fontSize: 15, marginTop: 5 },
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
