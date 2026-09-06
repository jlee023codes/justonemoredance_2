import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { colors } from "../styles";

/**
 * Shown after a password-reset link is opened. By the time we render, the
 * recovery link has already been turned into a real session (web: by
 * supabase-js's detectSessionInUrl; native: by App.tsx via
 * src/lib/authLinks.ts), which is what lets updateUser() work here.
 */
export function ResetPasswordScreen({
  email,
  onDone,
}: {
  email?: string;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const resetPassword = async () => {
    setError("");
    if (password.length < 6) {
      return setError("Your password must be at least 6 characters.");
    }
    if (password !== confirmPassword) {
      return setError("Those passwords don't match.");
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      // The usual cause is an expired or already-used link — the session
      // it created is gone, so there's nobody to update.
      return setError(
        /session|jwt|token/i.test(updateError.message)
          ? "That reset link has expired. Request a new one from the sign-in screen."
          : updateError.message,
      );
    }
    setSuccess(true);
  };

  const cancel = async () => {
    await supabase.auth.signOut();
    onDone();
  };

  if (success) {
    return (
      <View style={s.page}>
        <Text style={s.logo}>JUST ONE MORE</Text>
        <Text style={s.title}>PASSWORD UPDATED</Text>
        <Text style={s.subtitle}>
          Your password has been changed. You're signed in
          {email ? ` as ${email}` : ""}.
        </Text>
        <Pressable style={s.button} onPress={onDone}>
          <Text style={s.buttonText}>Continue to my dances</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.page}>
      <Text style={s.logo}>JUST ONE MORE</Text>
      <Text style={s.title}>RESET PASSWORD</Text>
      <Text style={s.subtitle}>
        {email
          ? `Choose a new password for ${email}.`
          : "Choose a new password for your account."}
      </Text>

      <TextInput
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        placeholder="New password (6+ characters)"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={setPassword}
        style={s.input}
        editable={!loading}
        autoFocus
      />
      <TextInput
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        placeholder="Confirm new password"
        placeholderTextColor={colors.muted}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        style={[
          s.input,
          !!confirmPassword && confirmPassword !== password && s.inputBad,
        ]}
        editable={!loading}
      />

      {error ? <Text style={s.error}>{error}</Text> : null}

      <Pressable
        disabled={loading}
        style={[s.button, loading && s.disabled]}
        onPress={resetPassword}
      >
        <Text style={s.buttonText}>
          {loading ? "Updating…" : "Update password"}
        </Text>
      </Pressable>
      <Pressable disabled={loading} style={s.link} onPress={cancel}>
        <Text style={s.linkText}>Cancel and sign out</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: 28,
  },
  logo: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3,
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 2,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 14,
    marginBottom: 26,
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 15,
    color: colors.ink,
    fontSize: 16,
    marginBottom: 12,
  },
  inputBad: { borderColor: "#ff8080" },
  error: { color: "#ff8080", fontSize: 13, lineHeight: 19, marginBottom: 10 },
  button: {
    backgroundColor: colors.pink,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  disabled: { opacity: 0.6 },
  link: { padding: 13, alignItems: "center" },
  linkText: { color: colors.muted, fontWeight: "700" },
});
