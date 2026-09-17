// The milestone ladder, keyed off how many dances someone's marked
// Learned. Shared between Profile (shows the full ladder + progress toward
// the next one) and Friends (shows just the current badge next to a name).
export const AWARDS = [
  { count: 1, icon: "🌟", title: "First Steps", note: "Learn 1 dance" },
  { count: 5, icon: "✨", title: "Dance Regular", note: "Learn 5 dances" },
  {
    count: 10,
    icon: "🏆",
    title: "Dance Floor Legend",
    note: "Learn 10 dances",
  },
  { count: 25, icon: "👑", title: "Headliner", note: "Learn 25 dances" },
  { count: 50, icon: "🔥", title: "Dance Machine", note: "Learn 50 dances" },
  { count: 100, icon: "💯", title: "Century Club", note: "Learn 100 dances" },
  { count: 200, icon: "😈", title: "Menace", note: "Learn 200 dances" },
];

export type Award = (typeof AWARDS)[number];

/** The highest award unlocked for a given learned-dance count — the badge
 *  someone would currently show off. Null below the first tier (0 learned). */
export function currentAward(learnedCount: number): Award | null {
  let current: Award | null = null;
  for (const award of AWARDS) {
    if (learnedCount < award.count) break;
    current = award;
  }
  return current;
}
