import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { colors } from "../styles";

/** A search TextInput that grows a "✕" once there's something typed, to
 *  clear it in one tap. Wraps whichever search-bar style a screen already
 *  has (padding/border/etc. all still apply) — just reserves room on the
 *  right so typed text never runs under the button. */
export function SearchInput({
  value,
  onChangeText,
  style,
  ...rest
}: TextInputProps & {
  value: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View style={s.wrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={[style, s.input]}
        {...rest}
      />
      {value.length > 0 && (
        <Pressable
          style={s.clear}
          onPress={() => onChangeText("")}
          hitSlop={10}
          accessibilityLabel="Clear search"
        >
          <Text style={s.clearIcon}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { justifyContent: "center" },
  input: { paddingRight: 38 },
  clear: {
    position: "absolute",
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  clearIcon: { color: colors.muted, fontSize: 15, fontWeight: "800" },
});
