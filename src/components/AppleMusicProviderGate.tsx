import { ReactNode } from "react";
import { Platform } from "react-native";

// @superfan-app/apple-music-auth has no web build (checked: no .web.ts in
// the package) — importing its Provider unconditionally would pull native
// module code into the web bundle. Only require it on native, same guard
// used in src/lib/appleMusicAuth.tsx for the hook itself.
let NativeProvider: React.ComponentType<{
  children: ReactNode;
  developerToken?: string;
}> | null = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NativeProvider = require("@superfan-app/apple-music-auth").AppleMusicAuthProvider;
}

/** Wraps children in @superfan-app/apple-music-auth's context provider on
 *  native (required for useAppleMusicConnect() in
 *  src/lib/appleMusicAuth.tsx to work in ProfileScreen) — a no-op pass-
 *  through on web, where Apple Music instead goes through MusicKit JS
 *  directly, no provider needed. */
export function AppleMusicProviderGate({
  developerToken,
  children,
}: {
  developerToken?: string;
  children: ReactNode;
}) {
  if (!NativeProvider) return <>{children}</>;
  const Provider = NativeProvider;
  return <Provider developerToken={developerToken}>{children}</Provider>;
}
