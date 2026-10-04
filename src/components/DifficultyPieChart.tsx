import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../styles";
import { Dance } from "../types";

// Deliberately its own palette, not DanceCard's shared DIFFICULTY_COLOR
// — a chart needs 4 visually distinct colors to read at a glance,
// where DanceCard.tsx's badges can afford Intermediate/Advanced
// sharing pink since the label text disambiguates them.
const CHART_COLOR: Record<Dance["difficulty"], string> = {
  Beginner: colors.green,
  Improver: colors.gold,
  Intermediate: colors.pink,
  Advanced: "#b05ce0",
};
const DIFFICULTY_ORDER: Dance["difficulty"][] = [
  "Beginner",
  "Improver",
  "Intermediate",
  "Advanced",
];

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** A single wedge, drawn as an SVG arc path from startAngle to endAngle
 *  (both in degrees, 0 = top, clockwise). A full-circle wedge (one
 *  difficulty only) falls back to a plain Circle — an arc path can't
 *  represent a 360° sweep (start and end points coincide). */
function Wedge({ cx, cy, r, startAngle, endAngle, color }: {
  cx: number; cy: number; r: number; startAngle: number; endAngle: number; color: string;
}) {
  if (endAngle - startAngle >= 359.99) {
    return <Circle cx={cx} cy={cy} r={r} fill={color} />;
  }
  const start = polarToXY(cx, cy, r, startAngle);
  const end = polarToXY(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const d = `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
  return <Path d={d} fill={color} />;
}

/** Breakdown of a night's dances by difficulty, as a small pie chart +
 *  legend. Dances logged before this field existed (difficulty: null)
 *  are excluded from the chart but don't crash it — just a smaller
 *  sample. Nothing renders if no dance in the set has a known difficulty. */
export function DifficultyPieChart({
  dances,
  size = 72,
}: {
  dances: { difficulty: Dance["difficulty"] | null }[];
  size?: number;
}) {
  const counts = new Map<Dance["difficulty"], number>();
  for (const d of dances) {
    if (!d.difficulty) continue;
    counts.set(d.difficulty, (counts.get(d.difficulty) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;

  const r = size / 2;
  let angle = 0;
  const wedges = DIFFICULTY_ORDER.filter((d) => counts.has(d)).map((difficulty) => {
    const count = counts.get(difficulty)!;
    const sweep = (count / total) * 360;
    const wedge = (
      <Wedge
        key={difficulty}
        cx={r}
        cy={r}
        r={r}
        startAngle={angle}
        endAngle={angle + sweep}
        color={CHART_COLOR[difficulty]}
      />
    );
    angle += sweep;
    return wedge;
  });

  return (
    <View style={s.row}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {wedges}
      </Svg>
      <View style={s.legend}>
        {DIFFICULTY_ORDER.filter((d) => counts.has(d)).map((difficulty) => (
          <View key={difficulty} style={s.legendRow}>
            <View style={[s.swatch, { backgroundColor: CHART_COLOR[difficulty] }]} />
            <Text style={s.legendText}>
              {difficulty} ({counts.get(difficulty)})
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  legend: { gap: 4 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
});
