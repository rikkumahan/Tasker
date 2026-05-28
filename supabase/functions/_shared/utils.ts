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

export async function processInBatches<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}
// ── TEMPORAL UTILITIES ──
export function getSeason(monthIndex: number): string {
  // Explicit mapping: Dec(11)/Jan(0)/Feb(1)=Winter, Mar-May=Spring, Jun-Aug=Summer, Sep-Nov=Fall
  const seasonMap = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall', 'Winter'];
  return seasonMap[monthIndex] || 'Winter';
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

// ─────────────────────────────────────────────
// EMAIL CLEANING PIPELINE
// ─────────────────────────────────────────────

/**
 * cleanEmailBody — strips noise before LLM ingestion.
 * Removes: HTML tags, quoted reply chains (> prefix lines),
 * signature delimiters (-- / ___), collapses whitespace.
 */
export function cleanEmailBody(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // Strip HTML tags
  text = text.replace(/<[^>]{0,200}>/g, " ");
  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  // Remove quoted reply lines (lines starting with > or >>)
  text = text.split("\n").filter(line => !/^\s*>/.test(line)).join("\n");
  // Remove signature blocks (common delimiters)
  text = text.replace(/^(-{2,}|_{2,}|={2,})\s*$/gm, "\n");
  // Collapse everything after a signature delimiter
  const sigIdx = text.search(/\n(-{2,}|_{2,})\s*\n/);
  if (sigIdx > 0) text = text.substring(0, sigIdx);
  // Collapse excessive whitespace
  text = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

/**
 * isSpamOrAd — free heuristic check, no LLM needed.
 * Returns true if the email is almost certainly promotional/system noise.
 */
export function isSpamOrAd(subject: string, sender: string, body: string): boolean {
  const s = subject.toLowerCase();
  const from = sender.toLowerCase();

  // No-reply senders are almost always automated
  if (/noreply|no-reply|donotreply|do-not-reply|notifications?@|alerts?@|newsletter@|marketing@|promo@|deals@|offers@|unsubscribe@/.test(from)) {
    return true;
  }
  // OTP / verification codes — never useful for task extraction
  if (/\b(otp|verification code|verify|your code is|one.?time|passcode|login code|sign.?in code)\b/.test(s)) {
    return true;
  }
  // Obvious promotional subject lines
  if (/\b(off|sale|discount|coupon|promo|offer|deal|clearance|limited time|% off|flash sale|buy now|shop now|order confirmed|receipt|invoice from)\b/.test(s)) {
    return true;
  }
  // Unsubscribe presence in body (strong spam signal)
  if (body && /unsubscribe|opt.?out|manage preferences|email preferences/i.test(body.substring(0, 500))) {
    return true;
  }

  return false;
}

/**
 * isWorthProcessing — returns false if the cleaned body
 * has fewer than 15 words (trivially short, nothing to extract).
 */
export function isWorthProcessing(cleanedBody: string): boolean {
  if (!cleanedBody) return false;
  const wordCount = cleanedBody.trim().split(/\s+/).filter(w => w.length > 0).length;
  return wordCount >= 15;
}
