// Regex escaper for safe string replacement
export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const safeDecode = (data: string): string => {
  try { return atob(data.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
};

export const decodeBody = (payload: any): string => {
  if (!payload) return "";
  const mime = payload.mimeType || "";
  if (mime === "text/plain") {
    const data = payload.body?.data;
    if (!data) return "";
    return safeDecode(data);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const b = decodeBody(part); if (b) return b;
    }
  }
  return "";
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── TEMPORAL UTILITIES ──
export function getSeason(monthIndex: number): string {
  const seasons = ['Winter', 'Spring', 'Summer', 'Fall'];
  return seasons[Math.floor(monthIndex / 3)];
}

// ─────────────────────────────────────────────
// POISON PILL DEFENSE: Lenient JSON Parser
// ─────────────────────────────────────────────
export const lenientParseArray = (text: string): any[] | null => {
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;
  try { return JSON.parse(arrMatch[0]); } catch {
    try {
      const repaired = arrMatch[0].replace(/,\s*]/g, "]").replace(/,\s*}/g, "}");
      return JSON.parse(repaired);
    } catch { return null; }
  }
};
