import { Component, ErrorInfo, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";

// React error boundaries only work as class components — there's no hook
// equivalent (as of React 19, still true). Without one, an uncaught
// render error anywhere below just unmounts the whole tree and Release
// builds show a blank screen with nothing logged anywhere — which is
// exactly what a black screen right after sign-in looked like: the very
// first mount of the whole authenticated app tree, all its effects only
// ever running for the first time in this process's life, with no
// boundary to catch whatever raced.
export class ErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: Error, info: ErrorInfo) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={s.wrap}>
          <Text style={s.title}>Something went wrong</Text>
          <Text style={s.message}>
            {this.state.error.message || "An unexpected error occurred."}
          </Text>
          <Pressable style={s.button} onPress={() => this.setState({ error: null })}>
            <Text style={s.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  title: { color: colors.ink, fontSize: 20, fontWeight: "900", marginBottom: 10 },
  message: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  buttonText: { color: colors.bg, fontWeight: "800", fontSize: 15 },
});
