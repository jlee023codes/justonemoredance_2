import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { colors } from "../styles";
export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (mode: "signIn" | "signUp") => {
    if (!email || password.length < 6)
      return Alert.alert(
        "Check your details",
        "Enter an email address and a password of at least 6 characters.",
      );
    setLoading(true);
    const result =
      mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) Alert.alert("Could not continue", result.error.message);
    else if (mode === "signUp" && !result.data.session)
      Alert.alert("Check your email", "Confirm your email, then sign in.");
  };
  const guest = async () => {
    setLoading(true);
    const result = await supabase.auth.signInAnonymously();
    setLoading(false);
    if (result.error)
      Alert.alert(
        "Guest mode is not enabled",
        "In Supabase, enable Anonymous Sign-Ins under Authentication → Providers, then try again.",
      );
  };
  return (
    <View style={s.page}>
      <Text style={s.logo}>JUST ONE MORE</Text>
      <Text style={s.title}>DANCE</Text>
      <Text style={s.subtitle}>
        Keep your dances synced across every dance floor.
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={setEmail}
        style={s.input}
      />
      <TextInput
        secureTextEntry
        placeholder="Password (6+ characters)"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={setPassword}
        style={s.input}
      />
      <Pressable
        disabled={loading}
        style={s.primary}
        onPress={() => submit("signIn")}
      >
        <Text style={s.primaryText}>{loading ? "Connecting…" : "Sign in"}</Text>
      </Pressable>
      <Pressable
        disabled={loading}
        style={s.secondary}
        onPress={() => submit("signUp")}
      >
        <Text style={s.secondaryText}>Create account</Text>
      </Pressable>
      <Pressable disabled={loading} style={s.guest} onPress={guest}>
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
    color: colors.gold,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 3,
  },
  title: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 5,
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
  primary: {
    backgroundColor: colors.pink,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  secondary: {
    borderColor: colors.gold,
    borderWidth: 1,
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryText: { color: colors.gold, fontWeight: "800" },
  guest: { padding: 15, alignItems: "center", marginTop: 5 },
  guestText: { color: colors.muted, fontWeight: "700" },
  loader: { marginTop: 15 },
});
