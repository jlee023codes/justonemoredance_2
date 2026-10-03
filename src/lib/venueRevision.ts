import { invokeEdgeFunction } from "./edgeFunctions";

/** Emails the owner a free-text correction note for a venue — see
 *  supabase/functions/venue-revision/index.ts. venue_nights writes are
 *  locked to admins/approved reps (migration_venue_reps.sql), so this
 *  is how anyone else flags something wrong. */
export async function submitVenueRevision(
  venueId: string,
  venueName: string,
  note: string,
): Promise<void> {
  await invokeEdgeFunction("venue-revision", { kind: "revision", venueId, venueName, note });
}

/** Notifies the owner that a rep request is waiting to be reviewed —
 *  the venue_representatives row itself is inserted separately, see
 *  requestVenueRep in src/services/venues.ts. */
export async function notifyVenueRepRequest(
  venueId: string,
  venueName: string,
  note: string,
): Promise<void> {
  await invokeEdgeFunction("venue-revision", { kind: "rep_request", venueId, venueName, note });
}
