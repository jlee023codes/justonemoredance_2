import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { DAY_LABEL, DAY_ORDER, DayOfWeek } from "../services/venues";

function toggle(list: DayOfWeek[], value: DayOfWeek): DayOfWeek[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Multi-select "filter by night" — collapsed out of the main toolbar
 *  into its own sheet (same bottom-sheet chrome as MyListToolsModal)
 *  since seven day chips plus Favorites/Danced Here/Near Me was too
 *  much to show inline at once. A venue matches if it dances ANY of
 *  the selected days. */
export function DayFilterModal({
  visible,
  selected,
  onChange,
  onClose,
}: {
  visible: boolean;
  selected: DayOfWeek[];
  onChange: (next: DayOfWeek[]) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.headerRow}>
            <Text style={s.title}>Filter by night</Text>
            {selected.length > 0 && (
              <Pressable onPress={() => onChange([])} hitSlop={8}>
                <Text style={s.clear}>Clear all</Text>
              </Pressable>
            )}
          </View>
          <Text style={s.hint}>Shows venues dancing on any of the nights you pick.</Text>

          <View style={s.chipWrap}>
            {DAY_ORDER.map((day) => {
              const active = selected.includes(day);
              return (
                <Pressable
                  key={day}
                  style={[s.chip, active && s.chipOn]}
                  onPress={() => onChange(toggle(selected, day))}
                  hitSlop={4}
                >
                  <Text style={[s.chipText, active && s.chipTextOn]}>{DAY_LABEL[day]}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable style={s.done} onPress={onClose}>
            <Text style={s.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 30,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  clear: { color: colors.pink, fontWeight: "800", fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  chipOn: { borderColor: colors.pink, backgroundColor: "#3a1f30" },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  chipTextOn: { color: colors.pink },
  done: {
    backgroundColor: colors.pink,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 22,
  },
  doneText: { color: "#fff", fontWeight: "900", fontSize: 15 },
});
