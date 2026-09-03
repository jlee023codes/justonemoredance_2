import { useEffect, useRef, useState } from "react";
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
  VenueOption,
} from "../services/venues";

/** Searchable "find or add a venue" picker, backed by the shared `venues`
 *  table in Supabase (not a local list) — typing filters live, and if
 *  nothing matches exactly you can add your own as a new venue. */
export function VenuePicker({
  visible,
  title = "Find or add a venue",
  selectedVenueId,
  alreadyAddedVenueIds,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title?: string;
  selectedVenueId?: string;
  // Venue ids this specific dance is already tied to — shown with a pin
  // icon and not selectable (there's nothing to re-add).
  alreadyAddedVenueIds?: string[];
  onSelect: (venue: VenueOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VenueOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setResults([]);
      setError("");
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchGlobalVenues(query)
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
  }, [query, visible]);

  const trimmedQuery = query.trim();
  const exactMatch = results.some(
    (venue) => venue.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  const handleAddNew = async () => {
    if (!trimmedQuery) return;
    setAdding(true);
    setError("");
    try {
      const venue = await findOrCreateGlobalVenue(trimmedQuery);
      onSelect(venue);
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
            {loading && (
              <ActivityIndicator color={colors.gold} style={s.loader} />
            )}

            {!loading &&
              results.map((venue) => {
                const alreadyAdded = alreadyAddedVenueIds?.includes(venue.id);
                return (
                  <Pressable
                    key={venue.id}
                    style={[
                      s.option,
                      selectedVenueId === venue.id && s.selected,
                      alreadyAdded && s.optionDisabled,
                    ]}
                    onPress={() => !alreadyAdded && onSelect(venue)}
                    disabled={alreadyAdded}
                  >
                    <Text
                      style={[s.optionText, alreadyAdded && s.optionTextDisabled]}
                    >
                      {alreadyAdded ? "📍 " : ""}
                      {venue.name}
                    </Text>
                    <Text style={s.check}>
                      {alreadyAdded
                        ? "Added"
                        : selectedVenueId === venue.id
                          ? "✓"
                          : ""}
                    </Text>
                  </Pressable>
                );
              })}

            {!loading && !results.length && !trimmedQuery && (
              <Text style={s.empty}>Start typing to search venues.</Text>
            )}

            {!loading && trimmedQuery.length > 0 && !exactMatch && (
              <Pressable
                style={s.addOption}
                onPress={handleAddNew}
                disabled={adding}
              >
                <Text style={s.addText}>
                  {adding ? "Adding…" : `＋ Add “${trimmedQuery}” as a new venue`}
                </Text>
              </Pressable>
            )}
          </ScrollView>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable onPress={onClose}>
            <Text style={s.cancel}>Cancel</Text>
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
  list: {
    flexGrow: 0,
  },
  loader: {
    marginVertical: 16,
  },
  option: {
    paddingVertical: 16,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  selected: {
    backgroundColor: "#392746",
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  optionText: {
    color: colors.ink,
    fontSize: 16,
    flex: 1,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionTextDisabled: {
    color: colors.muted,
  },
  check: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "900",
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 20,
  },
  addOption: {
    paddingVertical: 17,
    marginTop: 6,
  },
  addText: {
    color: colors.pink,
    fontSize: 16,
    fontWeight: "800",
  },
  error: {
    color: "#ff8080",
    fontSize: 13,
    marginTop: 10,
  },
  cancel: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 20,
  },
});
