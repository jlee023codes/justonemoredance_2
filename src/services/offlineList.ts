import AsyncStorage from "@react-native-async-storage/async-storage";

// A tiny on-device notepad of dance names the user jots down while offline —
// a single free-form text blob (one dance per line, bullets optional), not a
// structured list. It never touches Supabase — when they're back online, the
// text is parsed with the same parseNotesText used for a pasted Apple Notes
// checklist (see src/services/notesImport.ts) and pushed into the normal
// import queue from there.
//
// Stored per user so a shared device doesn't leak one person's list to the
// next. AsyncStorage is backed by localStorage on web, which is exactly the
// "closed the tab, reopened it, still logged in" case this feature targets.

const keyFor = (userId: string) => `jomd.offline-list.${userId}`;

export async function loadOfflineText(userId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(keyFor(userId))) ?? "";
  } catch {
    return "";
  }
}

export async function saveOfflineText(userId: string, text: string): Promise<void> {
  await AsyncStorage.setItem(keyFor(userId), text);
}

export async function clearOfflineList(userId: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(userId));
}

// Rough "how many dances" count for the tab badge — mirrors
// parseNotesText's own "a non-empty line counts" logic closely enough
// for a badge number without importing the full parser (and its link-
// splitting/bullet-stripping) just to count lines.
export async function countOfflineList(userId: string): Promise<number> {
  const text = await loadOfflineText(userId);
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}
