import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "../styles";
import {
  findOrCreateGlobalVenue,
  searchGlobalVenues,
  unvoteVenue,
  VenueOption,
  voteVenue,
} from "../services/venues";

/** Searchable "find or add a venue" picker, backed by the shared `venues`
 *  table. Two modes:
 *   - single (default): tap a venue → onSelect, sheet closes.
 *   - multi: check any number, then Save → onSaveMulti with the full list.
 *  Either way, each row shows a community thumbs-up count you can toggle. */
export function VenuePicker({
  visible,
  title = "Find or add a venue",
  userId,
  homeVenueId,
  selectedVenueId,
  alreadyAddedVenueIds,
  onSelect,
  multi = false,
  initialSelected = [],
  onSaveMulti,
  onClose,
}: {
  visible: boolean;
  title?: string;
  // Enables the thumbs-up control and "voted by me" state.
  userId?: string;
  // The user's home bar — pinned above the vote/name sort.
  homeVenueId?: string | null;
  // --- single-select ---
  selectedVenueId?: string;
  alreadyAddedVenueIds?: string[];
  onSelect?: (venue: VenueOption) => void;
  // --- multi-select ---
  multi?: boolean;
  initialSelected?: VenueOption[];
  onSaveMulti?: (venues: VenueOption[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VenueOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  // multi mode: id -> full VenueOption for everything currently checked.
  const [picked, setPicked] = useState<Map<string, VenueOption>>(new Map());
  const requestId = useRef(0);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setResults([]);
      setError("");
      setPicked(new Map(initialSelected.map((v) => [v.id, v])));
    }
    // initialSelected identity churns; only re-seed when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchGlobalVenues(query, userId)
        .then((venues) => {
          if (requestId.current !== id) return;
          setResults(venues);
          setLoading(false);
        })
        .catch((err) => {
          if (requestId.current !== id) return;
          setLoading(false);
          setError(err.message ?? "Could not load venues.");
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, visible, userId]);

  const trimmedQuery = query.trim();
  const exactMatch = results.some(
    (venue) => venue.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  // Merge in any freshly-picked venue that isn't in the current results, so
  // the checkmark has somewhere to live.
  const rows = useMemo(() => {
    const byId = new Map(results.map((v) => [v.id, v]));
    for (const v of picked.values()) if (!byId.has(v.id)) byId.set(v.id, v);
    return [...byId.values()].sort(
      (a, b) =>
        Number(b.id === homeVenueId) - Number(a.id === homeVenueId) ||
        Number(picked.has(b.id)) - Number(picked.has(a.id)) ||
        (b.votes ?? 0) - (a.votes ?? 0) ||
        a.name.localeCompare(b.name),
    );
  }, [results, picked, homeVenueId]);

  const applyVoteLocally = (id: string, delta: number, mine: boolean) => {
    setResults((cur) =>
      cur.map((v) =>
        v.id === id
          ? { ...v, votes: Math.max(0, (v.votes ?? 0) + delta), votedByMe: mine }
          : v,
      ),
    );
    setPicked((cur) => {
      const hit = cur.get(id);
      if (!hit) return cur;
      const next = new Map(cur);
      next.set(id, {
        ...hit,
        votes: Math.max(0, (hit.votes ?? 0) + delta),
        votedByMe: mine,
      });
      return next;
    });
  };

  const toggleVote = async (venue: VenueOption) => {
    if (!userId) return;
    const wasMine = !!venue.votedByMe;
    applyVoteLocally(venue.id, wasMine ? -1 : 1, !wasMine);
    try {
      if (wasMine) await unvoteVenue(userId, venue.id);
      else await voteVenue(userId, venue.id);
    } catch {
      applyVoteLocally(venue.id, wasMine ? 1 : -1, wasMine); // roll back
    }
  };

  const togglePicked = (venue: VenueOption) => {
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(venue.id)) next.delete(venue.id);
      else next.set(venue.id, venue);
      return next;
    });
  };

  const handleRowPress = (venue: VenueOption, alreadyAdded: boolean) => {
    if (alreadyAdded) return;
    if (multi) togglePicked(venue);
    else onSelect?.(venue);
  };

  const handleAddNew = async () => {
    if (!trimmedQuery) return;
    setAdding(true);
    setError("");
    try {
      const venue = await findOrCreateGlobalVenue(trimmedQuery);
      if (multi) {
        setPicked((cur) => new Map(cur).set(venue.id, venue));
        setQuery("");
      } else {
        onSelect?.(venue);
      }
    } catch (err: any) {
      setError(err.message ?? "Could not add that venue.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Text style={s.title}>{title}</Text>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search venues"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            style={s.search}
          />

          <ScrollView
            style={s.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {loading && !rows.length && (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            )}

            {rows.map((venue) => {
              const alreadyAdded = alreadyAddedVenueIds?.includes(venue.id);
              const checked = multi
                ? picked.has(venue.id)
                : selectedVenueId === venue.id;
              return (
                <Pressable
                  key={venue.id}
                  style={[
                    s.option,
                    checked && s.selected,
                    alreadyAdded && s.optionDisabled,
                  ]}
                  onPress={() => handleRowPress(venue, !!alreadyAdded)}
                  disabled={alreadyAdded}
                >
                  {multi && (
                    <View style={[s.check, checked && s.checkOn]}>
                      {checked && <Text style={s.checkMark}>✓</Text>}
                    </View>
                  )}
                  <View style={s.optionCopy}>
                    <Text
                      style={[
                        s.optionText,
                        alreadyAdded && s.optionTextDisabled,
                      ]}
                    >
                      {venue.id === homeVenueId
                        ? "🏠 "
                        : alreadyAdded
                          ? "📍 "
                          : ""}
                      {venue.name}
                    </Text>
                  </View>

                  <Pressable
                    style={s.voteButton}
                    onPress={() => toggleVote(venue)}
                    disabled={!userId}
                    hitSlop={8}
                  >
                    <Text
                      style={[s.voteText, venue.votedByMe && s.voteTextOn]}
                    >
                      {venue.votedByMe ? "★" : "☆"} {venue.votes ?? 0}
                    </Text>
                  </Pressable>

                  {!multi && !alreadyAdded && checked && (
                    <Text style={s.singleCheck}>✓</Text>
                  )}
                  {alreadyAdded && <Text style={s.addedTag}>Added</Text>}
                </Pressable>
              );
            })}

            {!loading && !rows.length && !trimmedQuery && (
              <Text style={s.empty}>Start typing to search venues.</Text>
            )}

            {!loading && trimmedQuery.length > 0 && !exactMatch && (
              <Pressable
                style={s.addOption}
                onPress={handleAddNew}
                disabled={adding}
              >
                <Text style={s.addText}>
                  {adding
                    ? "Adding…"
                    : `＋ Add “${trimmedQuery}” as a new venue`}
                </Text>
              </Pressable>
            )}
          </ScrollView>

          {error ? <Text style={s.error}>{error}</Text> : null}

          {multi ? (
            <Pressable
              style={s.saveButton}
              onPress={() => onSaveMulti?.([...picked.values()])}
            >
              <Text style={s.saveText}>
                {picked.size
                  ? `Save — ${picked.size} venue${picked.size === 1 ? "" : "s"}`
                  : "Save (none selected)"}
              </Text>
            </Pressable>
          ) : null}

          <Pressable onPress={onClose}>
            <Text style={s.cancel}>{multi ? "Cancel" : "Cancel"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 38,
    maxHeight: "80%",
  },
  title: {
    color: colors.ink,
    fontSize: 23,
    fontWeight: "900",
    marginBottom: 12,
  },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    padding: 13,
    fontSize: 15,
    marginBottom: 6,
  },
  list: { flexGrow: 0 },
  loader: { marginVertical: 16 },
  option: {
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  selected: {
    backgroundColor: "#392746",
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  optionDisabled: { opacity: 0.5 },
  optionCopy: { flex: 1 },
  optionText: { color: colors.ink, fontSize: 16 },
  optionTextDisabled: { color: colors.muted },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.line,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  checkMark: { color: "#fff", fontSize: 13, fontWeight: "900" },
  voteButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  voteText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  voteTextOn: { color: colors.gold },
  singleCheck: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 6,
  },
  addedTag: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 6,
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 20,
  },
  addOption: { paddingVertical: 17, marginTop: 6 },
  addText: { color: colors.pink, fontSize: 16, fontWeight: "800" },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  saveButton: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 16,
  },
  saveText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  cancel: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 18,
  },
});
