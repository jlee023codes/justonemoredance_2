import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors } from "../styles";
import { showAlert, showError } from "../lib/alerts";
// Preset badges are on hold — see AVATAR_PRESETS/AvatarPresetIcon in
// src/lib/avatarPresets.ts and src/components/AvatarPresetIcon.tsx for the
// code, kept in place in case they come back with different art.
// import { AVATAR_PRESETS, avatarUrlForPreset } from "../lib/avatarPresets";
// import { AvatarPresetIcon } from "./AvatarPresetIcon";
import { clearAvatar, uploadAvatarPhoto } from "../services/friends";
import { AvatarFocal } from "../lib/avatarFocal";
import { AvatarCropModal } from "./AvatarCropModal";

/** Bottom-sheet picker for a profile picture — currently just a photo
 *  from the device's library (positioned via AvatarCropModal), plus
 *  remove. Mirrors PlaylistSyncModal's sheet structure. */
export function AvatarPickerModal({
  visible,
  userId,
  hasAvatar,
  onClose,
  onChange,
}: {
  visible: boolean;
  userId: string;
  /** Shows "Remove photo" only when there's actually something to remove. */
  hasAvatar: boolean;
  onClose: () => void;
  /** Called with the new avatar_url (or null after removing) so the
   *  caller can update its own state without a full reload. */
  onChange: (avatarUrl: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  // The raw picked photo, awaiting circular crop positioning before it
  // actually uploads — see AvatarCropModal.
  const [pendingUri, setPendingUri] = useState<string | null>(null);

  // const choosePreset = async (id: (typeof AVATAR_PRESETS)[number]["id"]) => {
  //   setBusy(true);
  //   try {
  //     const avatarUrl = avatarUrlForPreset(id);
  //     await setAvatarPreset(userId, avatarUrl);
  //     onChange(avatarUrl);
  //     onClose();
  //   } catch (err: any) {
  //     showError(err, "Could not save that.");
  //   } finally {
  //     setBusy(false);
  //   }
  // };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert(
        "Photo access needed",
        "Allow access to your photo library in Settings to pick a profile picture.",
      );
      return;
    }
    // No system crop step here — the full photo goes straight into
    // AvatarCropModal's own circular positioner instead, since the
    // system's square crop doesn't match what a round avatar actually
    // shows.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setPendingUri(result.assets[0].uri);
  };

  const confirmCrop = async (focal: AvatarFocal) => {
    const uri = pendingUri;
    if (!uri) return;
    setPendingUri(null);
    setBusy(true);
    try {
      const avatarUrl = await uploadAvatarPhoto(userId, uri, focal);
      onChange(avatarUrl);
      onClose();
    } catch (err: any) {
      showError(err, "Could not upload that photo.");
    } finally {
      setBusy(false);
    }
  };

  const removeAvatar = async () => {
    setBusy(true);
    try {
      await clearAvatar(userId);
      onChange(null);
      onClose();
    } catch (err: any) {
      showError(err, "Could not remove your profile picture.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.title}>Profile picture</Text>

            <Pressable style={[s.uploadButton, busy && s.disabled]} onPress={pickFromLibrary} disabled={busy}>
              <Text style={s.uploadButtonText}>📷 Choose from your photos</Text>
            </Pressable>

            {/* Preset badges are on hold — see the commented-out
             *  choosePreset/import above.
            <Text style={s.subtitle}>Or pick a badge</Text>
            <ScrollView contentContainerStyle={s.grid}>
              {AVATAR_PRESETS.map((preset) => (
                <Pressable
                  key={preset.id}
                  style={[s.presetTile, { backgroundColor: preset.bgColor }, busy && s.disabled]}
                  onPress={() => choosePreset(preset.id)}
                  disabled={busy}
                >
                  <AvatarPresetIcon id={preset.id} color={preset.iconColor} size={30} />
                </Pressable>
              ))}
            </ScrollView>
            */}

            {busy && <ActivityIndicator color={colors.gold} style={s.loader} />}

            {hasAvatar && (
              <Pressable onPress={removeAvatar} disabled={busy} hitSlop={8}>
                <Text style={s.remove}>Remove profile picture</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={8} disabled={busy}>
              <Text style={s.cancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <AvatarCropModal
        visible={!!pendingUri}
        uri={pendingUri}
        onCancel={() => setPendingUri(null)}
        onConfirm={confirmCrop}
      />
    </>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#2b1f35",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 34,
    maxHeight: "80%",
  },
  title: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  subtitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 10,
  },
  uploadButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 16,
  },
  uploadButtonText: { color: colors.bg, fontWeight: "900", fontSize: 15 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  presetTile: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  loader: { marginTop: 16 },
  disabled: { opacity: 0.5 },
  remove: {
    color: "#ff8080",
    textAlign: "center",
    fontWeight: "700",
    fontSize: 13,
    marginTop: 20,
  },
  cancel: { color: colors.muted, textAlign: "center", fontWeight: "700", marginTop: 14 },
});
