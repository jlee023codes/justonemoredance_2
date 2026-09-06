import { Alert, Platform } from "react-native";

// React Native's Alert is a no-op on web, so every user-facing message
// has to branch. These two wrappers keep that branch in one place.

export function showAlert(title: string, message?: string) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

export function showError(err: any, fallback: string) {
  showAlert("Something went wrong", err?.message ?? fallback);
}

/** Resolves true if the user confirmed. `destructive` only affects iOS styling. */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel = "OK",
  destructive = false,
): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? "destructive" : "default",
        onPress: () => resolve(true),
      },
    ]);
  });
}
