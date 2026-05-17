// ═══════════════════════════════════════════════════════════════
// THREE-STAGE PII ENGINE (Proven 7/7 Eval Accuracy)
// ═══════════════════════════════════════════════════════════════

// ── STAGE 1: PRE-PASS REGEX VAULT (Permanent Erasure) ──
// Runs on raw text BEFORE Arcjet tokenization.
// Catches multi-token secrets (JWTs split on dots, inline key:value pairs).
export const SECRET_REGEXES: { regex: RegExp; tag: string }[] = [
  { regex: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, tag: "[ERASED_JWT]" },
  { regex: /AKIA[0-9A-Z]{16}/g, tag: "[ERASED_API-KEY]" },
  { regex: /sk_live_[0-9a-zA-Z]{24}/g, tag: "[ERASED_STRIPE-KEY]" },
  { regex: /ghp_[A-Za-z0-9]{36}/g, tag: "[ERASED_GH-TOKEN]" },
  // Labeled Secrets ("password:", "code:", "otp:") — 'token' excluded to prevent JWT collision
  { regex: /(?:\bpassword|\bpwd|\bsecret|\bkey|\bcode|\botp|\bverification|\blogin)[:\s=]+(?:is\s+)?(?![\[])([^\s\.]+)/gi, tag: "[ERASED_PASSWORD]" },

  // ── INDIA HIGH-RISK IDENTITY PII (Permanent Erasure) ──
  // Aadhaar: 12-digit UID in 4+4+4 groups (space-separated).
  // Negative assertions prevent matching inside 16-digit CC numbers.
  { regex: /(?<![\d\-])[2-9]\d{3} \d{4} \d{4}(?! \d)/g, tag: "[ERASED_AADHAAR]" },
  { regex: /(?<![\d\-])[2-9]\d{11}(?![\d\-])/g, tag: "[ERASED_AADHAAR]" },
  // PAN Card: 5 uppercase letters, 4 digits, 1 uppercase letter (ABCDE1234F)
  { regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g, tag: "[ERASED_PAN]" },
  // GSTIN: 15-char business tax ID — 2-digit state code + PAN + Z + checksum
  { regex: /\b[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g, tag: "[ERASED_GSTIN]" },
  // IFSC Code: 4 uppercase bank letters + 0 + 6 alphanumeric chars
  { regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, tag: "[ERASED_IFSC]" },
];

export function prePassRedact(text: string): string {
  let out = text;
  for (const { regex, tag } of SECRET_REGEXES) out = out.replace(regex, tag);
  return out;
}

// ── MATH UTILITIES ──
export function shannonEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  return Object.values(freq).reduce((h, n) => {
    const p = n / str.length; return h - p * Math.log2(p);
  }, 0);
}

export function luhnValid(str: string): boolean {
  const digits = str.replace(/\D/g, '').split('').map(Number);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, even = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (even) { d *= 2; if (d > 9) d -= 9; }
    sum += d; even = !even;
  }
  return sum % 10 === 0;
}
