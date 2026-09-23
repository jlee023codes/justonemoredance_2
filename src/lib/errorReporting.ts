import { Platform } from "react-native";
import { ErrorInfo } from "react";

// Native only for now — this is specifically here to catch the class of
// bug that produced a black screen right after sign-in on iOS (an
// uncaught render error on the app's first-ever mount of the
// authenticated tree, with nothing logged anywhere since there was no
// error boundary at all). The web build already surfaces errors in the
// browser console/devtools, so it's lower priority there.
//
// require(), not a top-level `import * as Sentry` — a static import gets
// bundled into the web build regardless of the Platform.OS checks below
// (those are runtime checks; Metro can't dead-code-eliminate based on
// them), which bloated the web bundle by ~2.6MB for a dependency that
// never runs there. Same guard pattern as appleMusicAuth.tsx.
let Sentry: typeof import("@sentry/react-native") | null = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Sentry = require("@sentry/react-native");
}

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initErrorReporting(): void {
  if (!Sentry || !dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0, // errors only for now — no performance monitoring
    // Long enough to see what led up to a crash (which screen, which
    // action) without keeping excessive history.
    maxBreadcrumbs: 50,
  });
}

/** Wired into ErrorBoundary's onError — reports to Sentry when configured,
 *  always logs locally too so `npx expo start` / Xcode console still show
 *  something during development regardless of whether Sentry is set up. */
export function reportError(error: Error, info: ErrorInfo): void {
  console.error("[ErrorBoundary]", error, info.componentStack);
  if (Sentry && dsn) {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  }
}
