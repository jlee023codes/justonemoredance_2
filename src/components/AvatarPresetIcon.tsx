import Svg, { Circle, Ellipse, Line, Path, Polygon, Rect } from "react-native-svg";
import { AvatarPresetId } from "../lib/avatarPresets";

// Every shape here is built from plain SVG primitives (circles, lines,
// polygons) with computed/verified coordinates, rather than freehand path
// artwork — there's no way to visually proof intricate hand-drawn shapes
// in this environment, so simple, mathematically predictable geometry is
// the reliable choice. viewBox is always 0 0 24 24.

// Five-pointed star, outer radius 9 / inner radius 3.8, centered at
// (12,12), first point straight up — standard alternating-radius
// construction (36° per point).
const STAR_POINTS =
  "12,3 14.23,8.93 20.56,9.22 15.61,13.17 17.29,19.28 12,15.8 6.71,19.28 8.39,13.17 3.44,9.22 9.77,8.93";

export function AvatarPresetIcon({
  id,
  color,
  size = 24,
}: {
  id: AvatarPresetId;
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {id === "badge" && <Polygon points={STAR_POINTS} fill={color} />}

      {/* Rounded head-and-shoulders blob — the shape originally built for
       *  "Cowboy Hat" before the real hat below was added; kept as-is once
       *  it turned out to read as a little person instead. */}
      {id === "person" && (
        <>
          <Ellipse cx={12} cy={16} rx={9} ry={2.5} fill={color} />
          <Ellipse cx={12} cy={9} rx={5} ry={6} fill={color} />
        </>
      )}

      {/* Side-profile cowboy hat: flat wide brim, a rounded band, and a
       *  peaked crown pinch on top — reads as a hat silhouette rather than
       *  the rounder blob above. */}
      {id === "cowboy-hat" && (
        <>
          <Ellipse cx={12} cy={16} rx={10} ry={2} fill={color} />
          <Rect x={7} y={9} width={10} height={6} rx={3} fill={color} />
          <Polygon points="8,9 12,4.5 16,9" fill={color} />
        </>
      )}

      {/* Western boot in side profile: tall shaft, angled toe, and a
       *  heel dropping below the sole line. */}
      {id === "cowboy-boot" && (
        <Polygon
          points="7,3 13,3 13,12 18,12 19,14 19,17 16,17 16,19 13,19 13,17 7,17"
          fill={color}
        />
      )}

      {/* Dancer mid-move: head, leaning torso, one arm thrown up, one arm
       *  swung out, a standing leg and a leg kicked up and out. */}
      {id === "dancer" && (
        <>
          <Circle cx={12} cy={5} r={2} fill={color} />
          <Line x1={12} y1={7} x2={10.5} y2={13} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={10.5} y1={8.5} x2={6} y2={4} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={10.5} y1={8.5} x2={16} y2={7} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={10.5} y1={13} x2={8} y2={20} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={10.5} y1={13} x2={18} y2={11} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      )}

      {id === "bandana" && (
        <>
          <Rect x={7} y={7} width={10} height={10} fill={color} transform="rotate(45 12 12)" />
          <Polygon points="10,18 12,22 9,20" fill={color} />
          <Polygon points="14,18 16,20 13,22" fill={color} />
        </>
      )}

      {id === "wagon-wheel" && (
        <>
          <Circle cx={12} cy={12} r={8} stroke={color} strokeWidth={2} fill="none" />
          <Circle cx={12} cy={12} r={2} fill={color} />
          <Line x1={12} y1={4} x2={12} y2={20} stroke={color} strokeWidth={1.5} />
          <Line x1={4} y1={12} x2={20} y2={12} stroke={color} strokeWidth={1.5} />
          <Line x1={6.34} y1={6.34} x2={17.66} y2={17.66} stroke={color} strokeWidth={1.5} />
          <Line x1={6.34} y1={17.66} x2={17.66} y2={6.34} stroke={color} strokeWidth={1.5} />
        </>
      )}

      {id === "music-note" && (
        <>
          <Circle cx={9} cy={17} r={3} fill={color} />
          <Line x1={12} y1={17} x2={12} y2={6} stroke={color} strokeWidth={2} />
          <Path d="M12 6 Q17 7 16 11" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}
