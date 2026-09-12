import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { showAlert } from "../lib/alerts";
import { passwordResetRedirectTo } from "../lib/authLinks";
import { colors } from "../styles";

// One form, two modes. "signIn" is where everyone starts; we only fall
// into "createAccount" (which adds the confirm-password field) once we
// know there's no account on that email yet.
type Mode = "signIn" | "createAccount";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<Mode>("signIn");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const resetToSignIn = () => {
    setMode("signIn");
    setConfirmPassword("");
    setError("");
    setNotice("");
  };

  /** Supabase answers "Invalid login credentials" for both a wrong
   *  password and an email nobody has registered — deliberately, so the
   *  API can't be used to enumerate accounts. This form needs to tell
   *  them apart, so it asks the database directly. */
  const emailIsRegistered = async (): Promise<boolean | null> => {
    const { data, error: rpcError } = await supabase.rpc("email_exists", {
      p_email: email.trim(),
    });
    if (rpcError) return null; // migration not run yet — caller falls back
    return Boolean(data);
  };

  const handleSignIn = async () => {
    setError("");
    setNotice("");
    if (!email.trim() || password.length < 6) {
      return setError(
        "Enter an email address and a password of at least 6 characters.",
      );
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (!signInError) {
      setLoading(false);
      return; // onAuthStateChange in App.tsx takes it from here
    }

    if (/email not confirmed/i.test(signInError.message)) {
      setLoading(false);
      return setError(
        "Confirm your email first — check your inbox for the link we sent.",
      );
    }
    if (!/invalid login credentials/i.test(signInError.message)) {
      setLoading(false);
      return setError(signInError.message);
    }

    const registered = await emailIsRegistered();
    setLoading(false);

    if (registered === true) {
      setError("That password doesn't match this account.");
    } else if (registered === false) {
      // No account yet: offer to make one, keeping what they typed.
      setMode("createAccount");
      setNotice(
        `No account for ${email.trim()} yet — confirm your password and we'll create one.`,
      );
    } else {
      setError(
        "Could not sign in. If you don't have an account yet, tap “Create an account instead”.",
      );
    }
  };

  const handleCreateAccount = async () => {
    setError("");
    if (password.length < 6) {
      return setError("Your password must be at least 6 characters.");
    }
    if (password !== confirmPassword) {
      return setError("Those passwords don't match.");
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signUpError) return setError(signUpError.message);

    // With email confirmation on, Supabase doesn't error on an already-
    // registered address — it returns a decoy user with no identities so
    // the API can't be used to enumerate accounts. Handle it explicitly,
    // otherwise this looks like a successful signup that never arrives.
    if (data.user && data.user.identities?.length === 0) {
      showAlert(
        "Account already exists",
        "There's already an account on that email. Go back and sign in, or use “Forgot my password”.",
      );
      return resetToSignIn();
    }

    if (!data.session) {
      // Email confirmation is on for this project.
      showAlert(
        "Check your email",
        "Confirm your email address, then come back and sign in.",
      );
      resetToSignIn();
    }
    // With confirmation off, signUp returns a session and App.tsx picks
    // it up through onAuthStateChange.
  };

  const forgotPassword = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      return setError("Enter your email address first, then tap this again.");
    }

    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: passwordResetRedirectTo() },
    );
    setLoading(false);

    if (resetError) return setError(resetError.message);
    showAlert(
      "Check your email",
      "We've sent you a link to set a new password. Open it on this device.",
    );
  };

  const guest = async () => {
    setError("");
    setLoading(true);
    const { error: guestError } = await supabase.auth.signInAnonymously();
    setLoading(false);
    if (guestError) {
      showAlert(
        "Guest mode is not enabled",
        "In Supabase, enable Anonymous Sign-Ins under Authentication → Providers, then try again.",
      );
    }
  };

  const creating = mode === "createAccount";

  return (
    <View style={s.page}>
      <Image
        source={require("../../assets/logo-dark.png")}
        style={s.logo}
        resizeMode="contain"
        accessibilityLabel="Just One More Dance"
      />
      <Text style={s.subtitle}>
        Keep your dances synced across every dance floor.
      </Text>

      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="Email"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          // A different email invalidates the "no account yet" answer.
          if (creating) resetToSignIn();
        }}
        style={s.input}
        editable={!loading}
      />
      <TextInput
        secureTextEntry
        autoCapitalize="none"
        textContentType={creating ? "newPassword" : "password"}
        placeholder="Password (6+ characters)"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={setPassword}
        style={s.input}
        editable={!loading}
      />
      {creating && (
        <TextInput
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
          placeholder="Confirm password"
          placeholderTextColor={colors.muted}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          style={[
            s.input,
            !!confirmPassword && confirmPassword !== password && s.inputBad,
          ]}
          editable={!loading}
          autoFocus
        />
      )}

      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      <Pressable
        disabled={loading}
        style={[s.primary, loading && s.disabled]}
        onPress={creating ? handleCreateAccount : handleSignIn}
      >
        <Text style={s.primaryText}>
          {loading
            ? "Connecting…"
            : creating
              ? "Create account"
              : "Sign in"}
        </Text>
      </Pressable>

      {creating ? (
        <Pressable disabled={loading} style={s.link} onPress={resetToSignIn}>
          <Text style={s.linkText}>← Back to sign in</Text>
        </Pressable>
      ) : (
        <Pressable
          disabled={loading}
          style={s.link}
          onPress={() => {
            setError("");
            setNotice("");
            setMode("createAccount");
          }}
        >
          <Text style={s.linkText}>Create an account instead</Text>
        </Pressable>
      )}

      {!creating && (
        <Pressable disabled={loading} style={s.link} onPress={forgotPassword}>
          <Text style={s.forgotText}>Forgot my password</Text>
        </Pressable>
      )}
      <Pressable disabled={loading} style={s.link} onPress={guest}>
        <Text style={s.guestText}>Continue as guest</Text>
      </Pressable>
      {loading && <ActivityIndicator color={colors.gold} style={s.loader} />}
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
    width: 168,
    height: 168,
    alignSelf: "center",
    marginBottom: 4,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 18,
    marginBottom: 30,
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
  primary: {
    backgroundColor: colors.pink,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  disabled: { opacity: 0.6 },
  link: { padding: 13, alignItems: "center" },
  linkText: { color: colors.gold, fontWeight: "800" },
  guestText: { color: colors.muted, fontWeight: "700" },
  forgotText: { color: colors.muted, fontWeight: "700" },
  notice: {
    color: colors.green,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  error: { color: "#ff8080", fontSize: 13, lineHeight: 19, marginBottom: 10 },
  loader: { marginTop: 15 },
});
