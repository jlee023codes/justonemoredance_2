import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "../styles";
import { AVATAR_PRESETS, presetIdFromAvatarUrl } from "../lib/avatarPresets";
import { AvatarPresetIcon } from "./AvatarPresetIcon";
import { avatarFocalStyle, parseAvatarFocal } from "../lib/avatarFocal";

/** One shared display for a profile picture everywhere it shows up —
 *  Profile's own header, Friends' roster rows, and the activity feed.
 *  Three states: an uploaded photo (any avatarUrl not starting with
 *  "preset:"), a premade icon badge ("preset:<id>"), or — when there's no
 *  avatar at all yet — a plain initial-letter badge so every row still
 *  has *something* to visually anchor on. */
export function Avatar({
  avatarUrl,
  label,
  size = 40,
}: {
  avatarUrl?: string | null;
  /** Display name / username — first letter used for the no-avatar
   *  fallback badge. */
  label: string;
  size?: number;
}) {
  const presetId = presetIdFromAvatarUrl(avatarUrl);
  const boxStyle = { width: size, height: size, borderRadius: size / 2 };

  if (presetId) {
    const preset = AVATAR_PRESETS.find((p) => p.id === presetId)!;
    return (
      <View style={[s.box, boxStyle, { backgroundColor: preset.bgColor }]}>
        <AvatarPresetIcon id={preset.id} color={preset.iconColor} size={size * 0.6} />
      </View>
    );
  }

  if (avatarUrl) {
    const focal = parseAvatarFocal(avatarUrl);
    return (
      <View style={[s.box, boxStyle]}>
        <Image
          source={{ uri: avatarUrl }}
          resizeMode="cover"
          style={[{ position: "absolute" }, avatarFocalStyle(size, focal)]}
        />
      </View>
    );
  }

  const initial = label.replace(/^@/, "").trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={[s.box, boxStyle, s.fallback]}>
      <Text style={[s.fallbackText, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fallback: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  fallbackText: { color: colors.muted, fontWeight: "800" },
});
