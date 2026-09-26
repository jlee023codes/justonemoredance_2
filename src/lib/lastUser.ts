import AsyncStorage from "@react-native-async-storage/async-storage";

// Who was last signed in on this device, purely so Offline Mode (see
// App.tsx's authStuck handling) has a userId to key the offline notepad
// to when there's no signal to ask Supabase who's signed in. Written
// every time we get a real session; read only when getSession() has been
// stuck loading for a while, never used for anything that touches RLS —
// this is not a substitute for a real session, just a label.
const KEY = "jomd.last-user";

export type LastUser = { userId: string; email: string | null };

export async function rememberLastUser(userId: string, email?: string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ userId, email: email ?? null }));
  } catch {
    // Non-critical — worst case Offline Mode has nothing to fall back to.
  }
}

export async function loadLastUser(): Promise<LastUser | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.userId === "string" ? parsed : null;
  } catch {
    return null;
  }
}
