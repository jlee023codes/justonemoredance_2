import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { venues as allVenues } from "../data";
import { colors } from "../styles";

export function VenuePicker({
  visible,
  title,
  selectedVenueId,
  onSelect,
  onClose,
  allowedVenueIds,
  showAddOption = false,
  onAddVenue,
}: {
  visible: boolean;
  title: string;
  selectedVenueId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  allowedVenueIds?: string[];
  showAddOption?: boolean;
  onAddVenue?: () => void;
}) {
  const availableVenues = allowedVenueIds
    ? allVenues.filter((venue) => allowedVenueIds.includes(venue.id))
    : allVenues;

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

          {availableVenues.map((venue) => (
            <Pressable
              key={venue.id}
              style={[s.option, selectedVenueId === venue.id && s.selected]}
              onPress={() => onSelect(venue.id)}
            >
              <Text style={s.optionText}>{venue.name}</Text>
              <Text style={s.check}>
                {selectedVenueId === venue.id ? "✓" : ""}
              </Text>
            </Pressable>
          ))}

          {showAddOption && onAddVenue && (
            <Pressable style={s.addOption} onPress={onAddVenue}>
              <Text style={s.addText}>＋ Add another venue</Text>
            </Pressable>
          )}

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
  },
  title: {
    color: colors.ink,
    fontSize: 23,
    fontWeight: "900",
    marginBottom: 12,
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
  check: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: "900",
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
  cancel: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
    marginTop: 20,
  },
});
