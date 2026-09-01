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
import { Dance, DanceProgress } from "../types";
import { colors } from "../styles";
import { DanceCard } from "./DanceCard";
import { VenuePicker } from "./VenuePicker";
import {
  addUserVenue,
  loadUserVenues,
  loadVenueDances,
  VenueOption,
} from "../services/venues";

export function MyVenuesScreen({
  userId,
  progress,
  onOpenDance,
}: {
  userId: string;
  progress: Record<string, DanceProgress>;
  onOpenDance: (dance: Dance) => void;
}) {
  const [myVenues, setMyVenues] = useState<VenueOption[]>([]),
    [venuesLoading, setVenuesLoading] = useState(true),
    [venuesError, setVenuesError] = useState(""),
    [selectedVenueId, setSelectedVenueId] = useState<string | null>(null),
    [venueQuery, setVenueQuery] = useState(""),
    [dropdownOpen, setDropdownOpen] = useState(false),
    [addPickerOpen, setAddPickerOpen] = useState(false),
    [venueDances, setVenueDances] = useState<
      { dance: Dance; songSwap?: string }[]
    >([]),
    [dancesLoading, setDancesLoading] = useState(false),
    [dancesError, setDancesError] = useState("");

  const refreshVenues = () => {
    setVenuesLoading(true);
    setVenuesError("");
    loadUserVenues(userId)
      .then((venues) => {
        setMyVenues(venues);
        setVenuesLoading(false);
        setSelectedVenueId((current) => current ?? venues[0]?.id ?? null);
      })
      .catch((err) => {
        setVenuesLoading(false);
        setVenuesError(err.message ?? "Could not load your venues.");
      });
  };

  useEffect(refreshVenues, [userId]);

  useEffect(() => {
    if (!selectedVenueId) {
      setVenueDances([]);
      return;
    }
    setDancesLoading(true);
    setDancesError("");
    loadVenueDances(userId, selectedVenueId)
      .then((dances) => {
        setVenueDances(dances);
        setDancesLoading(false);
      })
      .catch((err) => {
        setDancesLoading(false);
        setDancesError(err.message ?? "Could not load dances for this venue.");
      });
  }, [userId, selectedVenueId]);

  const selectedVenue = myVenues.find((v) => v.id === selectedVenueId);
  const filteredVenues = venueQuery.trim()
    ? myVenues.filter((v) =>
        v.name.toLowerCase().includes(venueQuery.trim().toLowerCase()),
      )
    : myVenues;

  const handleAddVenue = async (venue: VenueOption) => {
    setAddPickerOpen(false);
    try {
      await addUserVenue(userId, venue.id);
      setMyVenues((current) =>
        current.some((v) => v.id === venue.id)
          ? current
          : [...current, venue].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedVenueId(venue.id);
      setVenueQuery("");
      setDropdownOpen(false);
    } catch (err: any) {
      setVenuesError(err.message ?? "Could not add that venue.");
    }
  };

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.heading}>My Venues</Text>

      <View style={s.venueRow}>
        <View style={s.dropdownWrap}>
          <Pressable
            style={s.dropdownField}
            onPress={() => setDropdownOpen((open) => !open)}
          >
            <TextInput
              value={dropdownOpen ? venueQuery : selectedVenue?.name ?? ""}
              onChangeText={(text) => {
                setVenueQuery(text);
                setDropdownOpen(true);
              }}
              onFocus={() => {
                setVenueQuery("");
                setDropdownOpen(true);
              }}
              placeholder={
                myVenues.length ? "Search your venues" : "No venues yet"
              }
              placeholderTextColor={colors.muted}
              style={s.dropdownInput}
              editable={myVenues.length > 0}
            />
            <Text style={s.caret}>{dropdownOpen ? "▴" : "▾"}</Text>
          </Pressable>

          {dropdownOpen && (
            <View style={s.dropdownList}>
              {filteredVenues.map((venue) => (
                <Pressable
                  key={venue.id}
                  style={s.dropdownOption}
                  onPress={() => {
                    setSelectedVenueId(venue.id);
                    setVenueQuery("");
                    setDropdownOpen(false);
                  }}
                >
                  <Text style={s.dropdownOptionText}>{venue.name}</Text>
                  {selectedVenueId === venue.id && (
                    <Text style={s.check}>✓</Text>
                  )}
                </Pressable>
              ))}
              {!filteredVenues.length && (
                <Text style={s.dropdownEmpty}>No matching venues.</Text>
              )}
            </View>
          )}
        </View>

        <Pressable style={s.addButton} onPress={() => setAddPickerOpen(true)}>
          <Text style={s.addButtonText}>＋</Text>
        </Pressable>
      </View>

      {venuesError ? <Text style={s.error}>{venuesError}</Text> : null}

      {venuesLoading && !myVenues.length && (
        <ActivityIndicator color={colors.gold} style={s.loader} />
      )}

      {!venuesLoading && !myVenues.length && (
        <Text style={s.empty}>
          You haven't added any venues yet. Tap ＋ to add one, or add a dance
          to a venue from its details on the Home tab.
        </Text>
      )}

      {selectedVenueId && (
        <>
          <Text style={s.section}>DANCES AT {selectedVenue?.name.toUpperCase()}</Text>
          {dancesError ? <Text style={s.error}>{dancesError}</Text> : null}
          {dancesLoading && (
            <ActivityIndicator color={colors.gold} style={s.loader} />
          )}
          {!dancesLoading &&
            venueDances.map(({ dance, songSwap }) => (
              <DanceCard
                key={dance.id}
                dance={dance}
                song={songSwap ? `${songSwap} (swap)` : dance.defaultSong}
                progress={progress[dance.id]}
                onPress={() => onOpenDance(dance)}
              />
            ))}
          {!dancesLoading && !venueDances.length && !dancesError && (
            <Text style={s.empty}>
              No dances added to this venue yet — find one on Home and add it
              to your venue list.
            </Text>
          )}
        </>
      )}

      <VenuePicker
        visible={addPickerOpen}
        title="Add a venue"
        onSelect={handleAddVenue}
        onClose={() => setAddPickerOpen(false)}
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
  venueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  dropdownWrap: { flex: 1, position: "relative", zIndex: 10 },
  dropdownField: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  dropdownInput: {
    flex: 1,
    color: colors.ink,
    fontSize: 16,
    paddingVertical: 14,
  },
  caret: { color: colors.gold, fontSize: 16 },
  dropdownList: {
    position: "absolute",
    top: 54,
    left: 0,
    right: 0,
    backgroundColor: "#2b1f35",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    maxHeight: 220,
    overflow: "hidden",
  },
  dropdownOption: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dropdownOptionText: { color: colors.ink, fontSize: 15, flex: 1 },
  dropdownEmpty: {
    color: colors.muted,
    fontSize: 13,
    padding: 14,
    textAlign: "center",
  },
  check: { color: colors.gold, fontWeight: "900" },
  addButton: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  addButtonText: { color: "#fff", fontSize: 22, fontWeight: "900" },
  section: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: 26,
    marginBottom: 8,
  },
  empty: { color: colors.muted, fontSize: 14, marginTop: 14, lineHeight: 20 },
  error: { color: "#ff8080", fontSize: 13, marginTop: 10 },
  loader: { marginTop: 20 },
});
