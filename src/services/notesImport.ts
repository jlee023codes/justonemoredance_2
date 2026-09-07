import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------
// Parsing a pasted Apple Notes checklist
// ---------------------------------------------------------------------

export type ParsedDanceLine = {
  name: string;
  /** A trailing link the user kept next to the name, normalised to a URL. */
  link?: string;
  /** The Notes checklist item was checked off. */
  checked: boolean;
};

// Apple Notes doesn't export a file — people copy the note as plain text.
// A copied checklist comes through in a few different shapes depending on
// iOS version and whether it was a real checklist or a typed markdown list,
// so accept all of them.
const TASK_RE = /^[\s>]*(?:[-*+]\s*)?\[([ xX])\]\s*(.*)$/;
const GLYPH_RE = /^[\s>]*([☑☒☐✅✓✔•])\s*(.*)$/u;
const BULLET_RE = /^[\s>]*[-*+•·‣▪◦]\s+(.*)$/;
const CHECKED_GLYPHS = "☑☒✅✓✔";

/** Pull a clean list of dance names (with optional links) out of pasted note text. */
export function parseNotesText(raw: string): ParsedDanceLine[] {
  type Row = { text: string; checked: boolean; bulleted: boolean };
  const rows: Row[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let m = line.match(TASK_RE);
    if (m) {
      rows.push({ text: m[2].trim(), checked: /x/i.test(m[1]), bulleted: true });
      continue;
    }
    m = line.match(GLYPH_RE);
    if (m) {
      rows.push({
        text: m[2].trim(),
        checked: CHECKED_GLYPHS.includes(m[1]),
        bulleted: true,
      });
      continue;
    }
    m = line.match(BULLET_RE);
    if (m) {
      rows.push({ text: m[1].trim(), checked: false, bulleted: true });
      continue;
    }
    rows.push({ text: line.trim(), checked: false, bulleted: false });
  }

  // If the note uses bullets/checkboxes at all, only those are dances —
  // this drops heading lines like "My line dances".
  const hasBullets = rows.some((r) => r.bulleted);
  const picked = hasBullets ? rows.filter((r) => r.bulleted) : rows;

  const out: ParsedDanceLine[] = [];
  const seen = new Set<string>();
  for (const row of picked) {
    if (!row.text) continue;
    const { name, link } = splitTrailingLink(row.text);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue; // dedupe within this paste
    seen.add(key);
    out.push({ name, link, checked: row.checked });
  }
  return out;
}

function splitTrailingLink(text: string): { name: string; link?: string } {
  // "Name - youtube.com" / "Name – https://tiktok.com/@x/video/1"
  const dashed = text.match(/^(.+?\S)\s+[-–—]\s+(\S+)$/);
  if (dashed && looksLikeUrl(dashed[2])) {
    return { name: dashed[1].trim(), link: toUrl(dashed[2]) };
  }
  // Bare trailing URL: "Name https://…"
  const bare = text.match(/^(.+?\S)\s+((?:https?:\/\/|www\.)\S+)$/i);
  if (bare) return { name: bare[1].trim(), link: toUrl(bare[2]) };
  return { name: text.trim() };
}

function looksLikeUrl(s: string): boolean {
  if (/^https?:\/\//i.test(s)) return true;
  return /^[^\s]+\.[a-z]{2,}([/?#]\S*)?$/i.test(s);
}

function toUrl(s: string): string {
  const trimmed = s.trim().replace(/[.,;]+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// ---------------------------------------------------------------------
// The persisted import queue
// ---------------------------------------------------------------------

export type ImportItem = {
  id: string;
  rawName: string;
  rawLink?: string;
  suggestedStatus: "want" | "learned";
};

/** Queue every parsed line for matching. Returns how many rows were added. */
export async function queueImport(
  userId: string,
  lines: ParsedDanceLine[],
): Promise<number> {
  if (!lines.length) return 0;
  const rows = lines.map((line, i) => ({
    user_id: userId,
    raw_name: line.name,
    raw_link: line.link ?? null,
    suggested_status: line.checked ? "learned" : "want",
    position: i,
  }));
  const { error } = await supabase.from("dance_import_items").insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function loadPendingImport(userId: string): Promise<ImportItem[]> {
  const { data, error } = await supabase
    .from("dance_import_items")
    .select("id, raw_name, raw_link, suggested_status")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id as string,
    rawName: row.raw_name as string,
    rawLink: row.raw_link ?? undefined,
    suggestedStatus: row.suggested_status as "want" | "learned",
  }));
}

export async function countPendingImport(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("dance_import_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

export async function finishImportItem(
  id: string,
  status: "done" | "skipped",
): Promise<void> {
  const { error } = await supabase
    .from("dance_import_items")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
}

/** Drop already-handled rows once a run is finished. */
export async function clearFinishedImport(userId: string): Promise<void> {
  const { error } = await supabase
    .from("dance_import_items")
    .delete()
    .eq("user_id", userId)
    .neq("status", "pending");
  if (error) throw error;
}

/** Discard the whole queue — "start over". */
export async function clearImport(userId: string): Promise<void> {
  const { error } = await supabase
    .from("dance_import_items")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}
