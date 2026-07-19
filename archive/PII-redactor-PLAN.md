# PII Redaction Pipeline — Implementation Plan

## Objective

Build a pre-pass redaction layer that runs on every email BEFORE it is sent to the Groq LLM API (ActionExtractor, GraphRAGExtractor). It must strip credentials, financial identifiers, and government IDs while **preserving names, email addresses, company names, and dates**, since extraction quality depends on the LLM seeing those.

Non-negotiable constraint: **never redact more than necessary.** A name/email/date that gets wiped silently breaks `assigned_to` fields and graph entity extraction downstream. When in doubt about whether something should be redacted, it should NOT be redacted by default — flag it for review instead of guessing toward over-redaction.

---

## Architecture

```
Raw Email Body
      │
      ▼
┌─────────────────────────────────────────────┐
│ STAGE 1 — Known-pattern vault (openredaction)│
│ Configured explicitly, no presets            │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│ STAGE 2 — Statistical/heuristic catch-all    │
│ URL allowlist → digit-run Luhn → entropy     │
│ → keyword-anchored human secrets             │
└─────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────┐
│ STAGE 3 — NER layer (DEFERRED)               │
│ Only build if Stage 1+2 test results show    │
│ unstructured PII (names/addresses in free    │
│ text) still leaking through                  │
└─────────────────────────────────────────────┘
      │
      ▼
Safe Redacted Text → Groq
```

Stage 1 and Stage 2 solve different problems and are both required:
- Stage 1 catches **known, documented formats** (API key shapes, ID formats, card numbers by prefix, etc.) — broad but only as good as its pattern library.
- Stage 2 catches **anything with an unusual statistical shape**, including formats no pattern library has ever seen (a one-off internal token, a new vendor's key format). This is not redundant with Stage 1 — do not skip it.

Do not build Stage 3 yet. It is listed here so the agent doesn't independently decide to add it — only build it if Section 5 (Test Harness) surfaces a real gap.

---

## 1. Stage 1 — openredaction integration

**Package:** `openredaction` (https://github.com/sam247/openredaction), MIT licensed.

**Setup steps:**
1. `npm install openredaction`
2. Before wiring into any real pipeline, skim `packages/core` source directly to confirm the "100% local, no network calls" claim holds for the configuration used below. Do not take the README's word for it — this package sees 100% of sensitive user data before anything else does.
3. Read `packages/core`'s pattern-category definitions to get the **exact string keys** used by the `categories` config option. Do not guess these from README prose section headers.

**Required configuration — do not use any preset (`'gdpr'`, etc.):**

```ts
import { OpenRedaction } from 'openredaction';

const redactor = new OpenRedaction({
  includeNames: false,       // REQUIRED false — extraction needs real names
  includeEmails: false,      // REQUIRED false — needed for sender/direction identification
  includeAddresses: false,   // not needed for extraction
  includePhones: true,       // pick ONE owner for phone redaction — either this OR Stage 2, not both
  categories: [
    // fill in with verified exact keys from source, intent:
    // financial identifiers, government IDs, digital-identity/credential categories only
  ],
  whitelist: [
    // add known-safe company/product names used internally, if any false-positive
  ],
  redactionMode: 'token-replace',
  deterministic: true,       // same value -> same token, needed for downstream dedup logic
  confidenceThreshold: 0.6,  // start here, tune based on Section 5 test results
});
```

**India-specific IDs:** Aadhaar and PAN are NOT confirmed to be in openredaction's built-in "50+ countries" government ID set. Test directly (see Section 5). If missing, add via `customPatterns` using these verified formats:

```ts
// PAN — fixed format, low false-positive risk
/\b[A-Z]{5}\d{4}[A-Z]\b/g

// Aadhaar — only match space-grouped 4-4-4 to reduce collision with generic 12-digit numbers
/\b\d{4}\s\d{4}\s\d{4}\b/g
```

**Reversible restore — operational rule:**
If `suggested_reply` drafts ever need to reference a redacted value meaningfully (e.g. "I'll call you back" needing the real number), call `redactor.restore(llmResponseText, redactionMap)` **locally, server-side, after** the LLM response comes back. The `redactionMap` itself must NEVER be sent to Groq or logged anywhere. Treat it with the same handling rules as the raw secrets it maps to.

---

## 2. Stage 2 — Fixed heuristic scan

This stage runs on the output of Stage 1. Three specific bugs must be fixed relative to a naive whitespace-tokenize-then-check approach:

### 2a. URL allowlist (run FIRST, before entropy scanning)
Extract all URLs from the text and set them aside before entropy scanning runs. Re-merge them back into the final output untouched. Rationale: meeting links (Zoom/Meet join codes), tracking URLs, and Calendly-style links are legitimately high-entropy and are often the entire actionable content of the email (`action_type: "join"` depends on the LLM seeing the link). Do not let entropy scanning consume these.

```ts
const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;
```

### 2b. Digit-run regex for Luhn (do NOT whitespace-tokenize first)
Do not split on whitespace before checking for card numbers. A card written as `4111 1111 1111 1111` will be destroyed into four separate 4-digit tokens by naive tokenization, and Luhn will never validate any of them individually. Instead, regex-scan the raw text for digit-run candidates that tolerate internal separators, THEN strip separators and Luhn-check the full sequence:

```ts
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g;
// strip [ -], then run Luhn on the resulting digit string
```

### 2c. Entropy scan — with minimum length AND keyword-anchored fallback
- Apply Shannon entropy only to tokens above a minimum length threshold (e.g. 20 chars) — short tokens produce unreliable entropy signal and cause false positives on ordinary words.
- Entropy alone will MISS human-typed secrets (e.g. `Summer2024!`) because they don't have the statistical shape of machine-generated keys. Add a separate, entropy-independent keyword-anchored check:

```ts
const CREDENTIAL_KEYWORD_RE = /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/gi;
```

This keyword check does not require high entropy to fire — proximity to the trigger word is the signal, not the value's randomness.

### 2d. Skip already-redacted spans
Stage 2 must not re-process text already replaced with `[REDACTED:...]` tokens from Stage 1 — these are not sensitive and re-scanning them wastes cycles and risks nonsensical double-redaction.

---

## 3. Integration point

Wire the combined Stage 1 → Stage 2 pipeline behind the existing function signature already used by `ActionExtractor` and `GraphRAGExtractor`:

```ts
export function prePassRedact(text: string): string
```

Also expose a richer version for logging/audit purposes:

```ts
export interface RedactionResult {
  redactedText: string;
  redactionCounts: Record<string, number>; // category -> count, NEVER the matched value
  hadRedactions: boolean;
}
export function redactWithReport(text: string): RedactionResult
```

**Logging rule:** log only `redactionCounts` (category + count). Never log the matched value itself — that would defeat the entire purpose of redacting it.

---

## 4. Rollout plan — shadow mode before cutover

Do not replace the existing redaction module in production directly. Instead:

1. Deploy the new Stage 1+2 pipeline alongside the current one, in **shadow mode**: run both on every incoming email, but only the CURRENT pipeline's output is actually sent to Groq.
2. Log divergences between old and new output (which categories differ, not the values) for at least the volume needed to cover a representative sample of real traffic.
3. Manually review divergence logs for:
   - New pipeline catching something old one missed (expected improvement — verify it's a true positive, not noise)
   - New pipeline missing something old one caught (regression — must fix before cutover)
   - New pipeline redacting a name/email/date that should have survived (critical regression — blocks cutover)
4. Only cut traffic over to the new pipeline once divergence review shows no critical regressions.

---

## 5. Test harness — required before cutover

Build a labeled test set covering both directions. This is not optional — a redactor cannot be trusted without measured precision/recall per category.

**Must-survive set (should NOT be redacted):**
- Person names in various positions (greeting, signature, mid-sentence, `assigned_to`-style phrasing)
- Email addresses (sender/recipient references)
- Company names
- Dates and deadlines
- Order numbers, tracking numbers, invoice IDs, ticket numbers (lookalikes for the digit-run/entropy checks)
- Meeting URLs (Zoom/Meet/Calendly-style links with long tokens)

**Must-catch set (should be redacted):**
- Credit card numbers, space-separated, dash-separated, and unformatted (tests fix 2b specifically)
- SSN, PAN, Aadhaar (space-grouped)
- Private key blocks (PEM format)
- JWTs
- AWS/GitHub/Slack/generic API key formats
- IBAN
- Machine-generated high-entropy secrets (tests entropy scan)
- Human-typed passwords adjacent to `password:`/`pwd:`/`secret:` keywords (tests fix 2c specifically — must NOT rely on entropy alone)
- Bank account/routing numbers with keyword anchors

**Acceptance criteria for cutover:**
- 100% of must-survive cases pass unmodified (any failure here blocks cutover — this is the higher-priority failure mode per the non-negotiable constraint above)
- Must-catch cases: measure recall per category; investigate and address any category below ~95% recall before cutover

---

## 6. Explicitly deferred (do not build in this pass)

- **Stage 3 NER layer** (e.g. Presidio or similar) for unstructured PII (names/addresses mentioned in free-flowing text with no fixed pattern). Only revisit if Section 5 testing shows a real, measured gap here — not preemptively.
- Any redaction of names, email addresses, or company names — explicitly out of scope, would break extraction.

---

## Definition of done

- [ ] openredaction installed, configured with explicit category exclusions (no presets), Aadhaar/PAN verified or added as custom patterns
- [ ] Stage 2 rewritten with URL allowlist, digit-run Luhn scanning, minimum-length entropy check, and keyword-anchored credential detection
- [ ] `prePassRedact` and `redactWithReport` exposed with the signatures above, drop-in compatible with existing `ActionExtractor`/`GraphRAGExtractor` calls
- [ ] Logging emits category+count only, never matched values
- [ ] Shadow-mode run completed with divergence review showing no critical regressions
- [ ] Test harness built and passing acceptance criteria in Section 5
- [ ] `redactionMap` handling (if `restore()` is used) confirmed to never leave the trusted backend