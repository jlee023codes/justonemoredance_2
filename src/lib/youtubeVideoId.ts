// progress.link (the same reference-video URL My List's own "Watch video"
// chip reads — see DanceCard) can point anywhere: YouTube, TikTok,
// Instagram, or be empty. Only a real YouTube URL yields a video id;
// anything else is skipped, mirroring appleMusicTrackIdFromUrl's
// parse-and-return-null-on-anything-unexpected shape.

export function youtubeVideoIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") {
      return parsed.pathname.slice(1) || null;
    }
    if (host === "youtube.com") {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/")[2] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
