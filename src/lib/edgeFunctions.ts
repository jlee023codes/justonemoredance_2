import { supabase } from "./supabase";

// Shared invoke helper for Supabase Edge Functions — same
// session-refresh-then-explicit-header pattern already used in
// bootstepper.ts (functions.invoke's cached token can go stale after a tab
// sat idle; getSession() refreshes an expired one first, and passing the
// token explicitly avoids a propagation race).

async function describeFunctionError(error: any): Promise<string> {
  const base = error?.message ?? "Unknown error";
  const ctx = error?.context;
  try {
    if (ctx && typeof ctx.text === "function") {
      const body = (await ctx.text())?.trim();
      if (body) {
        let detail = body;
        try {
          detail = JSON.parse(body)?.error ?? body;
        } catch {
          /* not JSON — use the raw text */
        }
        const status = ctx.status ? ` (HTTP ${ctx.status})` : "";
        return `${detail}${status}`;
      }
      if (ctx.status) return `${base} (HTTP ${ctx.status})`;
    }
  } catch {
    /* fall through to base */
  }
  return base;
}

export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You're signed out — sign in again and try again.");
  }
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw new Error(await describeFunctionError(error));
  return data as T;
}
