// Free-tier cap on how many dances can sit on My List at once. Premium
// lifts it entirely. A dance already on the list (any status, including
// "none") always counts — this only blocks genuinely *new* additions.
export const FREE_DANCE_LIMIT = 50;

export function reachedDanceLimit(
  progress: Record<string, unknown>,
  isPremium: boolean,
): boolean {
  return !isPremium && Object.keys(progress).length >= FREE_DANCE_LIMIT;
}

export const DANCE_LIMIT_TITLE = "Your list is full";
export const DANCE_LIMIT_MESSAGE =
  "Upgrade to Premium or remove dances from your list to add more.";
