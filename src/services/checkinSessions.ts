import { supabase } from "../lib/supabase";
import { LoggedDance } from "../lib/checkinSession";

export type SessionHistoryEntry = {
  id: string;
  venueId: string;
  venueName: string;
  checkedInAt: string;
  endedAt: string;
  endReason: string | null;
  durationSeconds: number;
  dances: LoggedDance[];
  stepCount: number | null;
};

/** Past, closed-out check-in sessions for this user, newest first.
 *  Two-step fetch (checkins, then venue names) rather than an embedded
 *  select — keeps each query's select string a simple literal, same
 *  reasoning as VENUE_SELECT in services/venues.ts. */
export async function loadSessionHistory(userId: string): Promise<SessionHistoryEntry[]> {
  const { data: checkins, error } = await supabase
    .from("venue_checkins")
    .select("id,venue_id,checked_in_at,ended_at,end_reason,paused_seconds,step_count,logged_dances")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false });
  if (error) throw error;
  const rows = checkins ?? [];
  if (!rows.length) return [];

  const venueIds = [...new Set(rows.map((r: any) => r.venue_id as string))];
  const { data: venues, error: venuesError } = await supabase
    .from("venues")
    .select("id,name")
    .in("id", venueIds);
  if (venuesError) throw venuesError;
  const nameById = new Map((venues ?? []).map((v: any) => [v.id as string, v.name as string]));

  return rows.map((row: any) => {
    const startedAt = new Date(row.checked_in_at).getTime();
    const endedAt = new Date(row.ended_at).getTime();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt - startedAt) / 1000) - (row.paused_seconds ?? 0),
    );
    return {
      id: row.id,
      venueId: row.venue_id,
      venueName: nameById.get(row.venue_id) ?? "Unknown venue",
      checkedInAt: row.checked_in_at,
      endedAt: row.ended_at,
      endReason: row.end_reason,
      durationSeconds,
      dances: (row.logged_dances ?? []) as LoggedDance[],
      stepCount: row.step_count ?? null,
    };
  });
}
