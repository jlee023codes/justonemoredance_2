// Premade profile-picture options — flat icon badges, not illustrated
// artwork (see AvatarPresetIcon.tsx for the actual shapes, built from
// simple SVG primitives rather than freehand paths, since there's no way
// to visually proof intricate hand-drawn artwork in this environment).
// Stored on profiles.avatar_url as the literal string "preset:<id>" —
// Avatar.tsx tells a preset apart from an uploaded photo URL by that
// prefix.

export type AvatarPresetId =
  | "badge"
  | "person"
  | "cowboy-hat"
  | "cowboy-boot"
  | "dancer"
  | "bandana"
  | "wagon-wheel"
  | "music-note";

export type AvatarPreset = {
  id: AvatarPresetId;
  label: string;
  bgColor: string;
  iconColor: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "dancer", label: "Dancer", bgColor: "#3a1f30", iconColor: "#ff4e9b" },
  { id: "cowboy-hat", label: "Cowboy Hat", bgColor: "#1f3a2e", iconColor: "#77d9a4" },
  { id: "cowboy-boot", label: "Cowboy Boot", bgColor: "#3a2412", iconColor: "#e0a458" },
  { id: "badge", label: "Star", bgColor: "#3a3020", iconColor: "#ffc75a" },
  { id: "person", label: "Person", bgColor: "#24303a", iconColor: "#7bb8e0" },
  { id: "bandana", label: "Bandana", bgColor: "#3a2818", iconColor: "#ff8c42" },
  { id: "wagon-wheel", label: "Wagon Wheel", bgColor: "#1a3436", iconColor: "#4ecdc4" },
  { id: "music-note", label: "Music Note", bgColor: "#2a2040", iconColor: "#b39ddb" },
];

const PRESET_PREFIX = "preset:";

export function presetIdFromAvatarUrl(avatarUrl: string | null | undefined): AvatarPresetId | null {
  if (!avatarUrl?.startsWith(PRESET_PREFIX)) return null;
  const id = avatarUrl.slice(PRESET_PREFIX.length);
  return AVATAR_PRESETS.some((p) => p.id === id) ? (id as AvatarPresetId) : null;
}

export function avatarUrlForPreset(id: AvatarPresetId): string {
  return `${PRESET_PREFIX}${id}`;
}
