import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  Text,
} from "react-native";
import { colors } from "../styles";

export type BackToTopHandle = { scrollToTop: () => void };

const SHOW_AFTER = 400;

/** A ScrollView that grows a floating "↑ back to top" button once you've
 *  scrolled down a bit, and exposes scrollToTop() via ref — App.tsx wires
 *  that to tapping the header logo, so both do the same thing. Skipped on
 *  Profile (it's short and doesn't need either). */
export const BackToTopScrollView = forwardRef<
  BackToTopHandle,
  ScrollViewProps & { hideFab?: boolean }
>(function BackToTopScrollView({ hideFab, onScroll, children, ...props }, ref) {
  const scrollRef = useRef<ScrollView>(null);
  const [showFab, setShowFab] = useState(false);

  const scrollToTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });
  useImperativeHandle(ref, () => ({ scrollToTop }), []);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowFab(e.nativeEvent.contentOffset.y > SHOW_AFTER);
    onScroll?.(e);
  };

  return (
    <>
      <ScrollView
        {...props}
        ref={scrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
      {showFab && !hideFab && (
        <Pressable
          style={s.fab}
          onPress={scrollToTop}
          hitSlop={8}
          accessibilityLabel="Back to top"
        >
          <Text style={s.fabIcon}>↑</Text>
        </Pressable>
      )}
    </>
  );
});

const s = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    // Clears the bottom tab bar — same offset BulkRemoveBar uses.
    bottom: 74,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#2b1f35",
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  fabIcon: { color: colors.gold, fontSize: 19, fontWeight: "900" },
});
