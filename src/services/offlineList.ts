import AsyncStorage from "@react-native-async-storage/async-storage";

// A tiny on-device notepad of dance names the user jots down while offline.
// It never touches Supabase — when they're back online they push the whole
// list into the normal Apple-Notes import queue (see queueImport) and match
// each name to a real BootStepper dance from there.
//
// Stored per user so a shared device doesn't leak one person's list to the
// next. AsyncStorage is backed by localStorage on web, which is exactly the
// "closed the tab, reopened it, still logged in" case this feature targets.

export type OfflineDance = {
  id: string;
  name: string;
  note?: string;
  addedAt: string;
};

const keyFor = (userId: string) => `jomd.offline-list.${userId}`;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadOfflineList(userId: string): Promise<OfflineDance[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineDance[]) : [];
  } catch {
    return [];
  }
}

async function write(userId: string, items: OfflineDance[]): Promise<void> {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(items));
}

export async function addOfflineDance(
  userId: string,
  name: string,
  note?: string,
): Promise<OfflineDance[]> {
  const trimmed = name.trim();
  if (!trimmed) return loadOfflineList(userId);
  const items = await loadOfflineList(userId);
  const next = [
    ...items,
    {
      id: newId(),
      name: trimmed,
      note: note?.trim() || undefined,
      addedAt: new Date().toISOString(),
    },
  ];
  await write(userId, next);
  return next;
}

export async function updateOfflineDance(
  userId: string,
  id: string,
  patch: { name?: string; note?: string },
): Promise<OfflineDance[]> {
  const items = await loadOfflineList(userId);
  const next = items.map((item) =>
    item.id === id
      ? {
          ...item,
          name: patch.name?.trim() || item.name,
          note:
            patch.note === undefined
              ? item.note
              : patch.note.trim() || undefined,
        }
      : item,
  );
  await write(userId, next);
  return next;
}

export async function removeOfflineDance(
  userId: string,
  id: string,
): Promise<OfflineDance[]> {
  const items = (await loadOfflineList(userId)).filter((i) => i.id !== id);
  await write(userId, items);
  return items;
}

export async function clearOfflineList(userId: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(userId));
}

export async function countOfflineList(userId: string): Promise<number> {
  return (await loadOfflineList(userId)).length;
}
