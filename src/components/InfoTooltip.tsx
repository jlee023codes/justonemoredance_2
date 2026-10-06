import { useRef, useState } from "react";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";

const SCREEN_PADDING = 16;
const BUBBLE_WIDTH = 240;

/** A small "ⓘ" icon that pops a short explanation in a bubble anchored
 *  near it, instead of a modal alert — for a one-line hint that
 *  shouldn't take over the screen or always be visible. Measures its
 *  own on-screen position on tap (no library/positioning primitive
 *  already in this app for this) and clamps the bubble so it never
 *  runs off either screen edge. Tapping anywhere outside dismisses
 *  it, same as tapping the icon again. */
export function InfoTooltip({ text }: { text: string }) {
  const iconRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const open = () => {
    iconRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };

  const close = () => setAnchor(null);

  const screenWidth = Dimensions.get("window").width;
  const left = anchor
    ? Math.min(
        Math.max(anchor.x + anchor.width / 2 - BUBBLE_WIDTH / 2, SCREEN_PADDING),
        screenWidth - BUBBLE_WIDTH - SCREEN_PADDING,
      )
    : 0;
  const top = anchor ? anchor.y + anchor.height + 8 : 0;

  return (
    <>
      <Pressable ref={iconRef} onPress={open} hitSlop={8}>
        <Text style={s.icon}>ⓘ</Text>
      </Pressable>
      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={s.overlay} onPress={close}>
          {anchor && (
            <View style={[s.bubble, { left, top, width: BUBBLE_WIDTH }]}>
              <Text style={s.bubbleText}>{text}</Text>
            </View>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  icon: { color: colors.gold, fontSize: 16, fontWeight: "800", marginTop: 1 },
  overlay: { flex: 1 },
  bubble: {
    position: "absolute",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  bubbleText: { color: colors.ink, fontSize: 12.5, lineHeight: 18 },
});
