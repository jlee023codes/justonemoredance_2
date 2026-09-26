import { useRef, useState } from "react";
import {
  GestureResponderEvent,
  Image,
  Modal,
  PanResponder,
  PanResponderGestureState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../styles";
import { AvatarFocal, avatarFocalStyle } from "../lib/avatarFocal";

const BOX = 280;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3.5;
const ZOOM_STEP = 0.2;

// Web-only: without this, a mobile browser claims pinch/drag for its own
// page zoom/scroll before our PanResponder ever sees them — native
// iOS/Android have no such competing gesture owner, so this is purely a
// web quirk. `touchAction` isn't part of RN's ViewStyle type (it's a
// react-native-web-specific pass-through), hence the cast.
const noTouchAction = { touchAction: "none" } as object;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function pinchDistance(evt: GestureResponderEvent): number {
  const touches = evt.nativeEvent.touches;
  if (touches.length < 2) return 0;
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** Circular crop positioner shown after picking a photo, before it
 *  uploads — lets the user drag/pinch to choose what shows through the
 *  round avatar mask, since a plain square crop can leave content in the
 *  corners that never actually renders once every avatar in the app
 *  clips to a circle. No pixel cropping happens here or on upload — the
 *  full photo uploads as-is, and the chosen framing (fx/fy/zoom) is what
 *  every Avatar reads back to reproduce the same crop at any size. */
export function AvatarCropModal({
  visible,
  uri,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  uri: string | null;
  onCancel: () => void;
  onConfirm: (focal: AvatarFocal) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [fx, setFx] = useState(0.5);
  const [fy, setFy] = useState(0.5);
  const gestureStart = useRef({ zoom: 1, fx: 0.5, fy: 0.5, pinchDist: 0 });

  // The PanResponder below is built once (useRef) so its internal
  // gesture-math state survives across renders — but that also means its
  // callbacks close over whatever zoom/fx/fy were at the very first
  // render, forever, since a ref's initializer never re-runs. Mirroring
  // the live values into a ref that's reassigned every render is what
  // lets onPanResponderGrant see the *current* zoom instead of always
  // resetting to the first render's "1" at the start of every new touch.
  const live = useRef({ zoom, fx, fy });
  live.current = { zoom, fx, fy };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        gestureStart.current = { ...live.current, pinchDist: pinchDistance(evt) };
      },
      onPanResponderMove: (
        evt: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        const start = gestureStart.current;
        if (evt.nativeEvent.touches.length >= 2) {
          const dist = pinchDistance(evt);
          if (start.pinchDist > 0 && dist > 0) {
            setZoom(clamp(start.zoom * (dist / start.pinchDist), MIN_ZOOM, MAX_ZOOM));
          }
          return;
        }
        const maxOffset = BOX * start.zoom - BOX;
        if (maxOffset <= 0) return;
        setFx(clamp(start.fx - gesture.dx / maxOffset, 0, 1));
        setFy(clamp(start.fy - gesture.dy / maxOffset, 0, 1));
      },
    }),
  ).current;

  if (!uri) return null;
  const focal: AvatarFocal = { zoom, fx, fy };
  const imageStyle = avatarFocalStyle(BOX, focal);
  const r = BOX / 2 - 1;
  const holeD = `M0,0H${BOX}V${BOX}H0Z M${BOX / 2},${BOX / 2 - r} A${r},${r} 0 1 0 ${BOX / 2 - 0.01},${BOX / 2 - r} Z`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <Text style={s.title}>Position your photo</Text>
        <Text style={s.hint}>Drag to move, pinch to zoom.</Text>
        <View style={[s.box, noTouchAction]} {...responder.panHandlers}>
          <Image source={{ uri }} resizeMode="cover" style={[s.image, imageStyle]} />
          <Svg width={BOX} height={BOX} style={StyleSheet.absoluteFillObject} pointerEvents="none">
            <Path fillRule="evenodd" d={holeD} fill="rgba(0,0,0,0.6)" />
            <Circle cx={BOX / 2} cy={BOX / 2} r={r} stroke="#fff" strokeWidth={2} fill="none" />
          </Svg>
        </View>
        <View style={s.zoomRow}>
          <Pressable
            style={s.zoomButton}
            onPress={() => setZoom((z) => clamp(z - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
            hitSlop={8}
          >
            <Text style={s.zoomButtonText}>－</Text>
          </Pressable>
          <Text style={s.zoomLabel}>Zoom</Text>
          <Pressable
            style={s.zoomButton}
            onPress={() => setZoom((z) => clamp(z + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
            hitSlop={8}
          >
            <Text style={s.zoomButtonText}>＋</Text>
          </Pressable>
        </View>
        <View style={s.actions}>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
          <Pressable style={s.confirmButton} onPress={() => onConfirm(focal)}>
            <Text style={s.confirmText}>Use Photo</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#120a17ee",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: { color: colors.ink, fontSize: 18, fontWeight: "900", marginBottom: 4 },
  hint: { color: colors.muted, fontSize: 13, marginBottom: 18 },
  box: {
    width: BOX,
    height: BOX,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  image: { position: "absolute" },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 20 },
  zoomButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomButtonText: { color: colors.gold, fontSize: 18, fontWeight: "900" },
  zoomLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 24, marginTop: 26 },
  cancel: { color: colors.muted, fontWeight: "700", fontSize: 14 },
  confirmButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  confirmText: { color: colors.bg, fontWeight: "900", fontSize: 14 },
});
