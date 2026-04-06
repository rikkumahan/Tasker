# PII Redaction Engine

**Status**: Production ✅ | **Accuracy**: 8/9 tested cases  
**Location**: `supabase/functions/sync/index.ts`  
**Test Harness**: `diagnostics/run_deep_test.mjs`  
**Eval Suite**: `diagnostics/evals/pii_evals.json`

---

## What It Does

Every incoming email passes through a **Three-Stage Zero-Trust Pipeline** before any text is sent to the LLM. The goal: secrets are permanently destroyed, standard PII (like emails and phone numbers) are temporarily masked and restored after the LLM responds.

```
Raw Email
   │
   ▼
[STAGE 1] Pre-Pass Regex Vault   ── permanent erasure (JWTs, API keys, OTPs)
   │
   ▼
[STAGE 2] Arcjet WASM + Math     ── permanent erasure (high-entropy, credit cards)
   │
   ▼
[STAGE 3] PII Masking            ── temporary masking (emails, phones, IPs)
   │
   ▼
  LLM extracts tasks
   │
   ▼
[REHYDRATE] Restore PII Tokens   ── real contact info restored in task output
```

---

## Stage 1 — Pre-Pass Regex Vault

**File**: `sync/index.ts` lines 91–99  
**Why it runs first**: The Arcjet WASM tokenizer splits text on spaces and punctuation. A JWT like `eyJhbG...abc.xyz.sig` gets split on dots into three harmless-looking fragments. Stage 1 runs on the **raw string** before any tokenization.

| Pattern | Tag | Example Caught |
|---|---|---|
| JWT (base64url.base64url.base64url) | `[ERASED_JWT]` | `eyJhbGciOi...` |
| AWS Access Key | `[ERASED_API-KEY]` | `AKIAIOSFODNN7EXAMPLE` |
| Stripe Live Key | `[ERASED_STRIPE-KEY]` | `sk_live_51abc...` |
| GitHub Personal Token | `[ERASED_GH-TOKEN]` | `ghp_abc123...` |
| Labeled Secrets & OTPs | `[ERASED_PASSWORD]` | `OTP is 987654`, `key: abc123`, `password: hunter2` |

**The Safety Guard**: The labeled-secret regex has `(?![\\[])` — a negative lookahead that prevents the engine from re-redacting its own `[ERASED_...]` tags on a second pass.

---

## Stage 2 — Arcjet WASM + Mathematical Heuristics

**File**: `sync/index.ts` lines 188–211  
**Why it runs second**: Catches secrets that have no recognizable "shape" — things that weren't written by a specific vendor but are still highly random.

### Shannon Entropy Detection
```typescript
if (token.length > 16) {
  const h = shannonEntropy(token);
  if (h > 4.5 && /[0-9]/.test(token) && /[A-Z]/.test(token)) return "password";
}
```
If a token is longer than 16 characters and has an information entropy score above 4.5 bits/character (meaning it looks statistically random, not like a real word), it is flagged as a secret and permanently erased.

**Threshold rationale**: English prose averages ~4.0 bits/char. Truly random secrets typically score 4.7–5.2. The 4.5 threshold catches secrets while preserving long English words.

### Luhn Checksum for Credit Cards
```typescript
if (/^[0-9\-]{13,19}$/.test(token) && luhnValid(token)) return "credit-card";
```
Before erasing any 16-digit number, the engine validates it against the [Luhn algorithm](https://en.wikipedia.org/wiki/Luhn_algorithm). This prevents erasing safe tracking IDs and serial numbers that happen to look like credit card numbers. Only mathematically valid card numbers are erased.

**Output**: Permanent `[ERASED_CREDIT-CARD]` or `[ERASED_PASSWORD]` — never sent to LLM.

---

## Stage 3 — PII Masking + Rehydration

**File**: `sync/index.ts` lines 221–240  
**Why it runs last**: Emails, phone numbers, and IP addresses are not secrets — they are useful contact information. We mask them temporarily so the LLM never sees real personal data, then restore them in the final task output.

```typescript
// Masking (before LLM)
entities: ["email", "phone-number", "ip-address"],
replace: (entity) => `__PII_${entity}_${randomToken}__`  // e.g. __PII_email_x7k2f9a__

// Rehydration (after LLM responds)
const output = await unredactFn(llmResponse);
// "Contact __PII_email_x7k2f9a__" → "Contact rikku@example.com"
```

Arcjet's `redact()` function returns an `unredact()` closure that holds the mapping in memory for the duration of the request.

---

## Running the Eval Suite

```bash
cd diagnostics
node run_deep_test.mjs
```

Expected output when all shields hold:

```
HIGH-FIDELITY PII ENGINE - EVAL SUITE (9 tests)

[e_01_standard_pii] PASS
[e_02_jwt_secret] PASS
...
[e_08_otp_redaction] PASS

SCORE: 8/9 -- TUNING REQUIRED
```

> **Note**: `e_09_webhook` (Discord Webhook URL redaction) is currently a known gap. Webhook URLs are not caught by Stage 1 or the entropy detector because the secret token is embedded inside a URL path. See [Adding New Patterns](#adding-new-patterns) below.

---

## The Test Suite (`pii_evals.json`)

Each test case has this shape:

```json
{
  "id": "e_##_short_name",
  "description": "Human-readable explanation of what this tests.",
  "input": "The raw email text to run through the engine.",
  "expect_redacted_matches": ["[ERASED_JWT]"],   // Must appear in output
  "expect_not_redacted": ["Your", "meeting"]      // Must NOT be erased (false-positive guard)
}
```

### Current Test Coverage

| ID | What It Tests | Status |
|---|---|---|
| `e_01` | Standard PII — email, phone, IP | ✅ |
| `e_02` | JWT (multi-token secret) | ✅ |
| `e_03` | AWS Access Key + labeled secret | ✅ |
| `e_04` | `key:` and `code:` inline trigger | ✅ |
| `e_05` | False-positive trap: dates & times | ✅ |
| `e_06` | Valid Credit Card (Luhn-validated) | ✅ |
| `e_07` | Invalid CC (random digits, not Luhn) | ✅ |
| `e_08` | OTPs and verification codes | ✅ |
| `e_09` | Webhook URL with embedded token | ⚠️ Gap |

---

## Adding New Patterns

When a new secret type needs to be caught:

1. **Add a failing test case** to `diagnostics/evals/pii_evals.json`
2. **Run** `node diagnostics/run_deep_test.mjs` — confirm it fails
3. **Add a regex** to `SECRET_REGEXES` in `sync/index.ts` (and mirror it in `run_deep_test.mjs`)
4. **Run the suite again** — confirm all prior tests still pass (regression check)
5. **Deploy**: `npx supabase functions deploy sync --project-ref esngoeuhtpdzyfttofyu --no-verify-jwt`

### Regex Safety Rules (IMPORTANT)
- **Never use nested quantifiers** like `(a+)+` — causes catastrophic backtracking (ReDoS).
- **Always use `\b` word boundaries** to avoid runaway matches on long strings.
- **Always add `(?![\\[])` lookahead** on labeled-secret patterns to prevent tag collision.
- **Always test entropy side effects** — make sure the new regex doesn't have high entropy itself and get re-matched by Stage 2.

---

## Known Gap: Webhook URLs (`e_09`)

Webhook URLs like `https://discord.com/api/webhooks/12345/wJalrXUtnFEMI_K7MDENG` are not currently caught. The secret token is embedded in the URL path, which means:
- Stage 1 regex doesn't match (no `key:` prefix, not a JWT shape)
- Stage 2 entropy doesn't trigger (the URL is tokenized as a whole string, not split at `/`)

**Proposed fix** (pending):
```typescript
// Add to SECRET_REGEXES:
{ regex: /https:\/\/[^\s]+\/webhooks?\/[0-9]+\/[A-Za-z0-9\-_]{20,}/g, tag: "[ERASED_WEBHOOK]" }
```

---

## The Discovery Loop (Audit Log)

Because the engine cannot magically catch completely novel, proprietary tokens that have no recognizable structure, it relies on an **Audit Log** for safe discovery.

This completes the Human-in-the-Loop MLOps cycle: **Protect → Discover → Refine.**

### How the Log Works:
1. **Detection of "Uncertain" Tokens**: During Stage 2, tokens that have elevated entropy (e.g., between `3.5` and `4.5`) but aren't high enough to trigger an automatic redaction are flagged as "Suspicious".
2. **Silent Logging**: These suspicious tokens are printed to the Edge Function console using `console.warn("REVIEW QUEUE:", token)`. They are *not* redacted yet.
3. **Log Aggregation**: A developer periodically reviews the Supabase Edge Function logs.
4. **The Update Cycle**:
    - If a truly sensitive token is found in the logs, it means a leak occurred.
    - The developer adds the leaked string to `diagnostics/evals/pii_evals.json` as a *new* failing test case.
    - The developer updates `SECRET_REGEXES` or adjusts the entropy threshold.
    - The test harness (`run_deep_test.mjs`) verifies the exact fix offline.
    - The code is deployed with 100% confidence.

---

## What the System Does NOT Do

- **It will not catch completely novel PII formats immediately**. If it has no trigger keyword and low entropy, it passes through until caught by the Audit Log.
- **It does not auto-fix itself**. LLMs autonomously writing and deploying regex to a security layer is a ReDoS (Catastrophic Backtracking) and false-positive risk. Fixes are exclusively human-reviewed, locally tested against the eval suite, and manually deployed.
- **Rehydration is request-scoped**. The `unredact()` closure lives in memory for one request only. If the Edge Function crashes between masking and rehydration, the task will contain `__PII_email_xxx__` placeholder tokens instead of real addresses. The LLM extraction still works, but the contact info is lost for that request.
