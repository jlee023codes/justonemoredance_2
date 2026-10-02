import Svg, { Circle, Line, Path } from "react-native-svg";

// The bottom tab bar used to mix plain Unicode symbols (⌂, ≣, ☻) with real
// emoji (📍, 👥) — different glyph classes have different vertical metrics
// controlled by the font/OS, not by us, so no amount of box/lineHeight
// centering could make them align consistently (confirmed twice against
// real screenshots). SVG sidesteps the problem entirely: every icon here
// draws into the same 24x24 box with primitives (not freehand paths),
// same reasoning as AvatarPresetIcon — so centering the box centers the
// icon, guaranteed, on every platform.

export type TabIconName = "home" | "list" | "pin" | "people" | "person";

export function TabIcon({
  name,
  color,
  size = 22,
}: {
  name: TabIconName;
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "home" && (
        <Path
          d="M4 12 L12 5 L20 12 M4 12 V20 H20 V12"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}

      {name === "list" && (
        <>
          <Line x1={5} y1={7} x2={19} y2={7} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={5} y1={12} x2={19} y2={12} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Line x1={5} y1={17} x2={19} y2={17} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      )}

      {name === "pin" && (
        <>
          <Path
            d="M12 21C12 21 18 14.5 18 9.5A6 6 0 1 0 6 9.5C6 14.5 12 21 12 21Z"
            stroke={color}
            strokeWidth={1.8}
            strokeLinejoin="round"
            fill="none"
          />
          <Circle cx={12} cy={9.5} r={2.3} fill={color} />
        </>
      )}

      {name === "people" && (
        <>
          <Circle cx={9} cy={8} r={3.2} fill={color} />
          <Path d="M3 20c0-4 2.7-6.5 6-6.5s6 2.5 6 6.5" stroke={color} strokeWidth={1.7} fill="none" strokeLinecap="round" />
          <Circle cx={17} cy={9} r={2.6} fill={color} />
          <Path d="M13 20c0-3.2 2-5.6 5-5.9" stroke={color} strokeWidth={1.7} fill="none" strokeLinecap="round" />
        </>
      )}

      {name === "person" && (
        <>
          <Circle cx={12} cy={8.2} r={3.6} fill={color} />
          <Path
            d="M4.5 20.5c0-4.5 3.2-7.5 7.5-7.5s7.5 3 7.5 7.5"
            stroke={color}
            strokeWidth={1.9}
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}
