// Where in an uploaded photo the user positioned the circular crop —
// encoded onto the same avatar_url string as query params (fx/fy/z)
// rather than a new DB column, so the crop travels with the URL wherever
// it's already stored/read. A photo uploaded before this feature existed
// (or any URL missing these params) just falls back to centered/no zoom.
export type AvatarFocal = { zoom: number; fx: number; fy: number };

const DEFAULT_FOCAL: AvatarFocal = { zoom: 1, fx: 0.5, fy: 0.5 };

export function parseAvatarFocal(avatarUrl: string): AvatarFocal {
  const z = /[?&]z=([0-9.]+)/.exec(avatarUrl);
  const fx = /[?&]fx=([0-9.]+)/.exec(avatarUrl);
  const fy = /[?&]fy=([0-9.]+)/.exec(avatarUrl);
  return {
    zoom: z ? parseFloat(z[1]) : DEFAULT_FOCAL.zoom,
    fx: fx ? parseFloat(fx[1]) : DEFAULT_FOCAL.fx,
    fy: fy ? parseFloat(fy[1]) : DEFAULT_FOCAL.fy,
  };
}

export function appendAvatarFocal(avatarUrl: string, focal: AvatarFocal): string {
  const sep = avatarUrl.includes("?") ? "&" : "?";
  return `${avatarUrl}${sep}fx=${focal.fx.toFixed(4)}&fy=${focal.fy.toFixed(4)}&z=${focal.zoom.toFixed(3)}`;
}

/** How to size/position an `Image` (resizeMode "cover") inside an
 *  `overflow: hidden` square container of side `box` so the same region
 *  the user framed in the circular positioner shows through — works at
 *  any render size since fx/fy/zoom are all fractions, not pixels. */
export function avatarFocalStyle(box: number, focal: AvatarFocal) {
  const inner = box * focal.zoom;
  const maxOffset = inner - box;
  return {
    width: inner,
    height: inner,
    left: -focal.fx * maxOffset,
    top: -focal.fy * maxOffset,
  };
}
