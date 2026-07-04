// ═══════════════════════════════════════════════════════════════
// THREE-STAGE PII ENGINE (openredaction ESM + Native Heuristics)
// ═══════════════════════════════════════════════════════════════

import { OpenRedaction } from "npm:openredaction";

// Initialize OpenRedaction core instance with strict whitelists and safety guards
const redactor = new OpenRedaction({
  includeNames: false,
  includeEmails: false,
  includeAddresses: false,
  includePhones: true,
  enableContextAnalysis: false, // Bypass confidence threshold drop for custom patterns
  patterns: [
    // Digital Credentials / Keys
    "AWS_ACCESS_KEY",
    "JWT_TOKEN",
    "STRIPE_API_KEY",
    "GITHUB_TOKEN",
    "SLACK_TOKEN",
    "SLACK_WEBHOOK",
    "SSH_PRIVATE_KEY",
    "PRIVATE_KEY",
    "GENERIC_API_KEY",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "HEROKU_API_KEY",
    "MAILGUN_API_KEY",
    "TWILIO_API_KEY",
    "NPM_TOKEN",
    "PYPI_TOKEN",
    "OAUTH_TOKEN",
    "OAUTH_CLIENT_SECRET",
    "URL_WITH_AUTH",
    "DATABASE_CONNECTION",
    "DOCKER_AUTH",
    "KUBERNETES_SECRET",
    
    // Financial
    "CREDIT_CARD",
    "CVV",
    "CVV_CODE",
    "IBAN",
    "SWIFT_BIC",
    "ROUTING_NUMBER_US",
    "UK_BANK_ACCOUNT_IBAN",
    "UK_SORT_CODE_ACCOUNT",
    
    // Phones
    "PHONE_US",
    "PHONE_UK",
    "PHONE_UK_MOBILE",
    "PHONE_INTERNATIONAL",
  ],
  deterministic: true,
  customPatterns: [
    {
      type: "INDIAN_AADHAAR_CUSTOM",
      regex: /(?<![\d\-])[2-9]\d{3} \d{4} \d{4}(?! \d)/,
      placeholder: "[ERASED_AADHAAR]",
      priority: 10,
      severity: "high",
    },
    {
      type: "INDIAN_AADHAAR_CUSTOM_RAW",
      regex: /(?<![\d\-])[2-9]\d{11}(?![\d\-])/,
      placeholder: "[ERASED_AADHAAR]",
      priority: 10,
      severity: "high",
    },
    {
      type: "INDIAN_PAN_CUSTOM",
      regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/,
      placeholder: "[ERASED_PAN]",
      priority: 10,
      severity: "high",
    },
    {
      type: "INDIAN_GSTIN_CUSTOM",
      regex: /\b[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/,
      placeholder: "[ERASED_GSTIN]",
      priority: 10,
      severity: "high",
    },
    {
      type: "INDIAN_IFSC_CUSTOM",
      regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/,
      placeholder: "[ERASED_IFSC]",
      priority: 10,
      severity: "high",
    }
  ]
});

// Single pipeline executor that processes Stage 1 and Stage 2 in order
async function runRedactionPipeline(text: string): Promise<{ redactedText: string; detections: any[] }> {
  if (!text) return { redactedText: "", detections: [] };

  const allDetections: any[] = [];

  // Helper to redact a URL safely (ignores PHONE/EMAIL/NAME/GENERIC_API_KEY false positives on meeting links)
  const redactUrlSafely = async (url: string): Promise<string> => {
    const urlDetection = await redactor.detect(url);
    let redactedUrl = url;
    
    // Zoom/Meet join codes can match GENERIC_API_KEY or PHONE. Bypass them ONLY on true meeting hostnames.
    let isMeetingDomain = false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      const meetingHosts = ["zoom.us", "meet.google.com", "teams.microsoft.com", "calendly.com", "webex.com"];
      isMeetingDomain = meetingHosts.some(h => host === h || host.endsWith("." + h));
    } catch {
      isMeetingDomain = false; // Malformed URL - don't grant an exemption
    }

    const safeDetections = urlDetection.detections.filter(d => 
      !d.type.startsWith("PHONE") && 
      !d.type.startsWith("EMAIL") && 
      !d.type.startsWith("NAME") &&
      !(isMeetingDomain && d.type === "GENERIC_API_KEY")
    );
    
    allDetections.push(...safeDetections);
    
    safeDetections.sort((a, b) => b.position[0] - a.position[0]);
    for (const det of safeDetections) {
      const [start, end] = det.position;
      redactedUrl = redactedUrl.substring(0, start) + det.placeholder + redactedUrl.substring(end);
    }
    return redactedUrl;
  };

  // ── STAGE 2a: URL ALLOWLIST (extract & pre-scan URLs first to protect meeting codes) ──
  const uniqueUrls = Array.from(new Set(Array.from(text.matchAll(/\bhttps?:\/\/[^\s<>"]+/gi)).map(m => m[0])));
  const urls: string[] = [];
  let out = text;
  for (const url of uniqueUrls) {
    const redactedUrl = await redactUrlSafely(url);
    urls.push(redactedUrl);
    out = out.replaceAll(url, `__URL_PLACEHOLDER_${urls.length - 1}__`);
  }

  // ── STAGE 1: OPENREDACTION (on the remaining text) ──
  const detectionResult = await redactor.detect(out);
  out = detectionResult.redacted;
  allDetections.push(...detectionResult.detections);

  // ── STAGE 2b: DIGIT-RUN REGEX FOR LUHN ──
  out = out.replace(/\b\d(?:\s*-?\s*\d){12,18}\b/g, (match) => {
    const digits = match.replace(/[^0-9]/g, "");
    if (luhnValid(digits)) {
      return "[ERASED_CREDIT-CARD]";
    }
    return match;
  });

  // ── STAGE 2c: ENTROPY SCAN & KEYWORD CREDENTIALS ──
  // Helper to extract trailing sentence punctuation cleanly without leaking symbols
  const getTrailingPunct = (punct: string, val: string) => {
    let expectedClose = "";
    if (punct.includes("(")) expectedClose += ")";
    if (punct.includes("{")) expectedClose += "}";
    if (punct.includes("\"")) expectedClose += "\"";
    if (punct.includes("'")) expectedClose += "'";

    let trailingPunct = "";
    let secret = val;

    if (expectedClose.length > 0) {
      const escapedClose = expectedClose.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`([${escapedClose}][\\.\\,\\;\\?\\!]?)$`);
      const match = val.match(regex);
      if (match) {
        trailingPunct = match[0];
        secret = val.substring(0, val.length - trailingPunct.length);
      }
    } else {
      // Strip at most one trailing sentence punctuation character (exclude ! to protect passwords)
      const match = val.match(/([\.\,\;\?]+)$/);
      if (match) {
        trailingPunct = match[0];
        secret = val.substring(0, val.length - trailingPunct.length);
      }
    }
    return { secret, trailingPunct };
  };

  // Pass A: password/passwd/pwd (supports optional colon, equal, or helper verb "is")
  out = out.replace(/\b(password|passwd|pwd)(\s*(?:[:=]|\bis\b)\s*)([\(\{"']*)(\S+)/gi, (match, key, sep, punct, val) => {
    const { secret, trailingPunct } = getTrailingPunct(punct, val);
    const cleanSecret = secret.replace(/^[^a-zA-Z0-9\[]+/, "").replace(/[^a-zA-Z0-9\]]+$/, "");
    if (cleanSecret.startsWith("[") && cleanSecret.endsWith("]")) return match;
    return `${key}: ${punct}[ERASED_PASSWORD]${trailingPunct}`;
  });

  // Pass B: secret/api_key/token (strictly requires colon or equal sign to prevent sentence false positives)
  out = out.replace(/\b(secret|api[_-]?key|access[_-]?token)(\s*[:=]\s*)([\(\{"']*)(\S+)/gi, (match, key, sep, punct, val) => {
    const { secret, trailingPunct } = getTrailingPunct(punct, val);
    const cleanSecret = secret.replace(/^[^a-zA-Z0-9\[]+/, "").replace(/[^a-zA-Z0-9\]]+$/, "");
    if (cleanSecret.startsWith("[") && cleanSecret.endsWith("]")) return match;
    return `${key}: ${punct}[ERASED_CREDENTIAL]${trailingPunct}`;
  });

  // 2. Shannon Entropy scanner for remaining tokens (with punctuation cleanup and ticket/order protection)
  const tokens = out.split(/\s+/);
  const skipKeywords = /\b(ticket|order|tracking|invoice|po|reference|ref|job|id|invoiceid|poid|booking|req|request|task|case|shipment|trackingid)\b/i;

  out = tokens.map((token, index) => {
    const cleanToken = token.replace(/^[^a-zA-Z0-9\[]+/, "").replace(/[^a-zA-Z0-9\]]+$/, "");
    if (cleanToken.startsWith("[") && cleanToken.endsWith("]")) return token;

    let isTicketOrOrder = false;
    for (let i = 1; i <= 2; i++) {
      if (index - i >= 0) {
        const prevToken = tokens[index - i].replace(/[^a-zA-Z0-9]/g, "");
        if (skipKeywords.test(prevToken)) {
          isTicketOrOrder = true;
          break;
        }
      }
    }

    if (isTicketOrOrder) return token;

    if (cleanToken.length > 16 && /[0-9]/.test(cleanToken) && /[A-Z]/.test(cleanToken) && /[a-z]/.test(cleanToken)) {
      if (shannonEntropy(cleanToken) > 4.0) {
        return token.replace(cleanToken, "[ERASED_SECRET]");
      }
    }
    return token;
  }).join(" ");

  // ── STAGE 2d: RESTORE URLS ──
  out = out.replace(/__URL_PLACEHOLDER_(\d+)__/g, (_, index) => {
    const idx = parseInt(index, 10);
    return urls[idx] || "";
  });

  return {
    redactedText: out,
    detections: allDetections,
  };
}

export async function prePassRedact(text: string): Promise<string> {
  const { redactedText } = await runRedactionPipeline(text);
  return redactedText;
}

export interface RedactionResult {
  redactedText: string;
  redactionCounts: Record<string, number>;
  hadRedactions: boolean;
}

export async function redactWithReport(text: string): Promise<RedactionResult> {
  const { redactedText, detections } = await runRedactionPipeline(text);
  const counts: Record<string, number> = {};

  // 1. Process OpenRedaction detections and map custom types to standard categories
  for (const det of detections) {
    let category = det.type;
    if (category.startsWith("INDIAN_AADHAAR_CUSTOM")) category = "INDIAN_AADHAAR";
    else if (category === "INDIAN_PAN_CUSTOM") category = "INDIAN_PAN";
    else if (category === "INDIAN_GSTIN_CUSTOM") category = "INDIAN_GSTIN";
    else if (category === "INDIAN_IFSC_CUSTOM") category = "INDIAN_IFSC";
    
    counts[category] = (counts[category] || 0) + 1;
  }

  // 2. Count Stage 2 native tags (excluding custom patterns to prevent double-counting)
  const customTags = [
    { tag: "[ERASED_CREDIT-CARD]", category: "CREDIT_CARD" },
    { tag: "[ERASED_PASSWORD]", category: "PASSWORD" },
    { tag: "[ERASED_CREDENTIAL]", category: "CREDENTIAL" },
    { tag: "[ERASED_SECRET]", category: "HIGH_ENTROPY_SECRET" },
  ];

  for (const { tag, category } of customTags) {
    let pos = 0;
    let occurrences = 0;
    while (true) {
      pos = redactedText.indexOf(tag, pos);
      if (pos === -1) break;
      occurrences++;
      pos += tag.length;
    }
    if (occurrences > 0) {
      counts[category] = (counts[category] || 0) + occurrences;
    }
  }

  return {
    redactedText,
    redactionCounts: counts,
    hadRedactions: Object.keys(counts).length > 0,
  };
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
