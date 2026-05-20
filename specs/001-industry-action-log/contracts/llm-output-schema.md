# Contract: LLM Output Schema

**Interface**: Groq API response → `extractRawTasks` parser in `stages.ts`
**Direction**: LLM → Backend

---

## Description

This contract defines the exact JSON schema the LLM must return for each email in the batch extraction prompt. The backend parser in `stages.ts` reads this structure and maps it to the `tasks` table columns.

---

## Schema (per email object in the returned array)

```json
{
  "source_email_id": "string — the Gmail message ID passed in context",
  "title": "string — short action headline, max 80 chars",
  "summary": "string — 2-3 sentence context of what the email says and why it matters",
  "deadline": "string | null — extracted due date in natural language (e.g. 'Friday 23 May') or null",
  "category": "string — normalized project or client name used as cluster label",
  "action_type": "approval_required | reply_needed | blocker | event | delegated_tracking | awareness",
  "impact_level": "high | medium | low",
  "sender_organization": "string | null — normalized company name (e.g. 'Stripe', not 'stripe.com')",
  "escalation_risk": "string | null — max 2 sentences describing consequence of ignoring. null if no risk.",
  "suggested_reply_draft": {
    "options": [
      { "label": "string — intent label e.g. Approve", "text": "string — full draft reply text" },
      { "label": "string", "text": "string" }
    ]
  } | null
}
```

---

## Rules

- `suggested_reply_draft` MUST be non-null only for `action_type` values of `approval_required` or `reply_needed`
- `suggested_reply_draft.options` MUST contain exactly 2 or 3 items when present
- `action_type` MUST be one of the 6 defined enum values — no free text
- `impact_level` MUST be one of the 3 defined values — no free text
- `sender_organization` MUST be normalized: title-case, no domain suffixes, no "Inc." or "Ltd." unless part of common brand name
- `escalation_risk` MUST be null for `action_type` of `awareness` or `event` unless content explicitly contains a consequence
- The entire batch response MUST be a valid JSON array with one object per email — no markdown, no backticks

---

## Example

```json
[
  {
    "source_email_id": "18f3a2c9b1d4e567",
    "title": "Approve Q3 vendor contract before Friday",
    "summary": "Priya from Razorpay has sent the revised vendor contract for Q3. She needs your approval signature by Friday 23 May or the contract window expires and pricing resets to standard rates.",
    "deadline": "Friday 23 May",
    "category": "Razorpay",
    "action_type": "approval_required",
    "impact_level": "high",
    "sender_organization": "Razorpay",
    "escalation_risk": "If unsigned by Friday, pricing reverts to standard rates — approximately 18% higher. Priya mentioned this will require re-approval from her finance team.",
    "suggested_reply_draft": {
      "options": [
        {
          "label": "Approve",
          "text": "Hi Priya, I have reviewed the contract and I am happy to approve. Please proceed with the signing process at your end."
        },
        {
          "label": "Request Extension",
          "text": "Hi Priya, I need a couple more days to review the revised terms. Could we extend the window to Monday 26 May? Appreciate your flexibility."
        },
        {
          "label": "Escalate Internally",
          "text": "Hi Priya, I am looping in our legal team before final approval. We will revert by Thursday EOD."
        }
      ]
    }
  }
]
```
