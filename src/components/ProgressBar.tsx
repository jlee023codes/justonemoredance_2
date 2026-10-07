import { StyleSheet, View } from "react-native";
import { colors } from "../styles";

/** A simple filled progress bar — done/total, clamped to [0, 1]. Used
 *  wherever a bulk operation (importing a pasted list, adding several
 *  dances at once) runs one item at a time with no other visual
 *  feedback, so a long list doesn't read as hung with just a spinner
 *  and a text counter. */
export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <View style={s.track}>
      <View style={[s.fill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const s = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.pink,
  },
});
