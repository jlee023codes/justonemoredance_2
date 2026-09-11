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
import { ActivityItem, loadFriendActivity } from "../services/activity";
import {
  clearRsvp,
  EventRsvpStatus,
  FriendEvent,
  loadUpcomingEvents,
  setRsvp,
} from "../services/events";
import { loadHomeVenueId } from "../services/venues";
import { FriendDancesModal } from "./FriendDancesModal";
import { MakeEventModal } from "./MakeEventModal";
import { Dance, DanceProgress } from "../types";

// @username, plus "(Display Name)" only when they've actually set one.
// Works whether `displayName` is the raw (possibly null) column or
// Friend.displayName's labelFor fallback — either way it's never equal to
// the handle unless there's genuinely nothing to add.
function friendLabel(f: { username: string; displayName?: string | null }): string {
  const handle = `@${f.username}`;
  return f.displayName && f.displayName !== handle
    ? `${handle} (${f.displayName})`
    : handle;
}

// The rest of the feed line, after "@handle (Name) ".
function activityMessage(item: ActivityItem): string {
  if (item.kind === "dances") {
    const verb = item.action === "learned" ? "learned" : "added";
    if (item.dances.length === 1) return `just ${verb} ${item.dances[0].name}`;
    return `${verb} ${item.dances.length} new dances, click to see which ones`;
  }
  if (item.venues.length === 1) {
    return `added a new venue to their list: ${item.venues[0].name}`;
  }
  return `added ${item.venues.length} new venues to their list, click to see which ones`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

const RSVP_OPTIONS: { status: EventRsvpStatus; icon: string; label: string }[] = [
  { status: "going", icon: "🙋", label: "Going" },
  { status: "maybe", icon: "🤔", label: "Maybe" },
  { status: "cant", icon: "🚫", label: "Can't" },
];

export function FriendsScreen({
  userId,
  email,
  progress,
  onProgressChange,
  onOpenDance,
  onPendingRequestCountChange,
}: {
  userId: string;
  email?: string;
  /** Passed through to FriendDancesModal so it can mark dances the user
   *  already has. */
  progress: Record<string, DanceProgress>;
  onProgressChange: (danceId: string, next: DanceProgress | null) => void;
  /** Lets tapping a dance in the activity feed open its details. */
  onOpenDance: (dance: Dance) => void;
  // Keeps the badge on the Friends tab in step with what's on screen.
  onPendingRequestCountChange?: (count: number) => void;
}) {
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

  // Home bar, just so the "Make Event" venue picker can pin it to the top.
  const [homeVenueId, setHomeVenueId] = useState<string | null>(null);

  // Events + RSVPs
  const [events, setEvents] = useState<FriendEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [makeEventOpen, setMakeEventOpen] = useState(false);

  // Friend activity feed
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const refreshEvents = () => {
    setEventsLoading(true);
    setEventsError("");
    loadUpcomingEvents(userId)
      .then(setEvents)
      .catch((err: any) => setEventsError(err.message ?? "Could not load events."))
      .finally(() => setEventsLoading(false));
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
    refreshEvents();
    loadHomeVenueId(userId).then(setHomeVenueId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Re-load the activity feed whenever the friend list settles on a
  // different set of people.
  const friendIdsKey = friends
    .map((f) => f.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!friends.length) {
      setActivity([]);
      setActivityLoading(false);
      return;
    }
    setActivityLoading(true);
    setActivityError("");
    loadFriendActivity(friends)
      .then(setActivity)
      .catch((err: any) =>
        setActivityError(err.message ?? "Could not load friend activity."),
      )
      .finally(() => setActivityLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendIdsKey]);

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

  // Optimistic — update this one event's headcount/my-answer locally
  // instead of re-fetching the whole list, so RSVPing doesn't flash a
  // spinner over events you (and everyone else) are already looking at.
  // Tapping your already-selected answer again clears it.
  const handleRsvp = async (event: FriendEvent, status: EventRsvpStatus) => {
    const previous = event.myRsvp;
    const clearing = previous === status;
    setEvents((current) =>
      current.map((e) => {
        if (e.id !== event.id) return e;
        const counts = { ...e.counts };
        if (previous) counts[previous] = Math.max(0, counts[previous] - 1);
        if (!clearing) counts[status] += 1;
        return { ...e, counts, myRsvp: clearing ? undefined : status };
      }),
    );
    try {
      if (clearing) await clearRsvp(userId, event.id);
      else await setRsvp(userId, event.id, status);
    } catch (err: any) {
      showAlert("Could not RSVP", err.message ?? "Try again in a moment.");
      refreshEvents();
    }
  };

  const toggleExpanded = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.heading}>Friends</Text>

      {email ? (
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
              <Text style={s.hint}>Tap to change it. Long-press to copy.</Text>
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
          {usernameError ? <Text style={s.error}>{usernameError}</Text> : null}

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
                <Text style={s.nameSaveText}>{savingName ? "…" : "Save"}</Text>
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
              style={[s.addFriendButton, !usernameSearch.trim() && s.disabled]}
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
                <Pressable onPress={() => handleRemoveFriend(friend)} hitSlop={8}>
                  <Text style={s.friendRemove}>✕</Text>
                </Pressable>
              </Pressable>
            ))}
        </View>
      ) : (
        <View style={s.statRow}>
          <Text style={s.statLabel}>
            You're signed in as a guest! Create an account to add friends.
          </Text>
        </View>
      )}

      {friends.length > 0 && (
        <>
          <View style={s.listHead}>
            <Text style={s.section}>EVENTS</Text>
            <View style={s.listHeadActions}>
              <Pressable
                style={s.refreshButton}
                onPress={refreshEvents}
                disabled={eventsLoading}
                hitSlop={8}
              >
                <Text style={s.refreshText}>{eventsLoading ? "…" : "⟳"}</Text>
              </Pressable>
              <Pressable
                style={s.makeEventButton}
                onPress={() => setMakeEventOpen(true)}
              >
                <Text style={s.makeEventText}>🎉 Make event</Text>
              </Pressable>
            </View>
          </View>

          {eventsError ? <Text style={s.error}>{eventsError}</Text> : null}
          {eventsLoading && !events.length && (
            <ActivityIndicator color={colors.gold} style={s.inlineLoader} />
          )}
          {!eventsLoading && !events.length && !eventsError && (
            <Text style={s.hint}>
              No upcoming events — make one and your friends will see it here.
            </Text>
          )}

          {events.map((event) => (
            <View key={event.id} style={s.eventCard}>
              <Text style={s.eventVenue}>📍 {event.venueName}</Text>
              <Text style={s.eventWhen}>{formatWhen(event.startsAt)}</Text>
              <Text style={s.eventCreator}>
                Made by {friendLabel(event.creator)}
                {event.note ? ` — ${event.note}` : ""}
              </Text>
              <View style={s.rsvpRow}>
                {RSVP_OPTIONS.map((opt) => {
                  const active = event.myRsvp === opt.status;
                  return (
                    <Pressable
                      key={opt.status}
                      style={[s.rsvpButton, active && s.rsvpButtonOn]}
                      onPress={() => handleRsvp(event, opt.status)}
                    >
                      <Text style={[s.rsvpIcon, active && s.rsvpTextOn]}>
                        {opt.icon}
                      </Text>
                      <Text style={[s.rsvpLabel, active && s.rsvpTextOn]}>
                        {opt.label} ({event.counts[opt.status]})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </>
      )}

      {friends.length > 0 && (
        <>
          <Text style={s.section}>ACTIVITY</Text>
          {activityError ? <Text style={s.error}>{activityError}</Text> : null}
          {activityLoading && (
            <ActivityIndicator color={colors.gold} style={s.inlineLoader} />
          )}
          {!activityLoading && !activity.length && !activityError && (
            <Text style={s.hint}>
              Nothing from your friends in the last week.
            </Text>
          )}
          {!activityLoading &&
            activity.map((item, i) => {
              const key =
                item.kind === "dances"
                  ? `d-${item.friend.id}-${item.action}`
                  : `v-${item.friend.id}`;
              const isOpen = expanded.has(key);
              const count =
                item.kind === "dances" ? item.dances.length : item.venues.length;

              return (
                <View key={key + i} style={s.activityRow}>
                  <Pressable
                    onPress={() => count > 1 && toggleExpanded(key)}
                    disabled={count <= 1}
                  >
                    <Text style={s.activityText}>
                      {friendLabel(item.friend)} {activityMessage(item)}
                    </Text>
                  </Pressable>
                  {isOpen && item.kind === "dances" && (
                    <View style={s.activityExpand}>
                      {item.dances.map((d) => (
                        <Pressable
                          key={d.id}
                          onPress={() =>
                            onOpenDance({
                              id: d.id,
                              name: d.name,
                              defaultSong: d.song,
                              difficulty: d.difficulty,
                              details: "",
                              songSwaps: [],
                              snapshot: true,
                            })
                          }
                        >
                          <Text style={s.activityExpandItem}>• {d.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {isOpen && item.kind === "venues" && (
                    <View style={s.activityExpand}>
                      {item.venues.map((v) => (
                        <Text key={v.id} style={s.activityExpandItem}>
                          • {v.name}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
        </>
      )}

      <FriendDancesModal
        userId={userId}
        friend={selectedFriend}
        progress={progress}
        onClose={() => setSelectedFriend(null)}
        onProgressChange={onProgressChange}
      />

      <MakeEventModal
        visible={makeEventOpen}
        userId={userId}
        homeVenueId={homeVenueId}
        onClose={() => setMakeEventOpen(false)}
        onCreated={refreshEvents}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 115 },
  heading: { color: colors.ink, fontSize: 25, fontWeight: "900", marginBottom: 14 },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 25,
    marginBottom: 8,
  },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 25,
  },
  listHeadActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  refreshButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: { color: colors.gold, fontSize: 16, fontWeight: "800" },
  friendsCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16 },
  settingLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  myUsername: { color: colors.gold, fontSize: 22, fontWeight: "900", marginTop: 4 },
  setUsernameButton: {
    backgroundColor: colors.pink,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginTop: 6,
  },
  setUsernameText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  usernameEditRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  atSign: { color: colors.gold, fontSize: 16, fontWeight: "900" },
  atSignInline: { color: colors.muted, fontSize: 15, fontWeight: "700", marginRight: 4 },
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
  hint: { color: colors.muted, fontSize: 14, lineHeight: 17, marginTop: 8 },
  inlineLoader: { alignSelf: "flex-start", marginTop: 10 },
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
  addFriendRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
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
  friendRemove: { color: colors.muted, fontSize: 14, paddingHorizontal: 6, marginLeft: 6 },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 6,
  },
  requestHandle: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  pendingName: { color: colors.muted, fontSize: 14, flex: 1, fontWeight: "700" },
  acceptButton: { backgroundColor: colors.pink, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 8 },
  acceptText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  declineButton: { paddingHorizontal: 10, paddingVertical: 8 },
  declineText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  statRow: { backgroundColor: colors.card, borderRadius: 14, padding: 15, flexDirection: "row" },
  statLabel: { color: colors.ink, fontSize: 16, flex: 1 },
  makeEventButton: {
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  makeEventText: { color: colors.pink, fontWeight: "800", fontSize: 12 },
  eventCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  eventVenue: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  eventWhen: { color: colors.gold, fontSize: 12, fontWeight: "800", marginTop: 3 },
  eventCreator: { color: colors.muted, fontSize: 12, marginTop: 5 },
  rsvpRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  rsvpButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  rsvpButtonOn: { borderColor: colors.pink, backgroundColor: "#3a1f30" },
  rsvpIcon: { fontSize: 13 },
  rsvpLabel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  rsvpTextOn: { color: colors.pink },
  activityRow: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  activityText: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  activityExpand: { marginTop: 6, paddingLeft: 4 },
  activityExpandItem: { color: colors.muted, fontSize: 13, marginBottom: 4 },
});
